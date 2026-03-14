// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC4626} from "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

/// @notice Minimal Aave V3 Pool interface (supply + withdraw)
interface IPool {
    function supply(
        address asset,
        uint256 amount,
        address onBehalfOf,
        uint16 referralCode
    ) external;

    function withdraw(
        address asset,
        uint256 amount,
        address to
    ) external returns (uint256);
}

/// @notice Minimal ERC-4626 vault interface (Felix / MetaMorpho vaults)
interface IERC4626Vault {
    function deposit(uint256 assets, address receiver) external returns (uint256 shares);
    function withdraw(uint256 assets, address receiver, address owner) external returns (uint256 shares);
    function redeem(uint256 shares, address receiver, address owner) external returns (uint256 assets);
    function balanceOf(address account) external view returns (uint256);
    function convertToAssets(uint256 shares) external view returns (uint256);
    function asset() external view returns (address);
    function maxWithdraw(address owner) external view returns (uint256);
}

/// @title  YieldVault
/// @notice ERC-4626 vault that allocates deposits across Aave V3 lending pools
///         and ERC-4626 vaults (Felix/MetaMorpho) on HyperEVM to maximize yield.
/// @dev    An authorized allocator (the AI agent) can reallocate between protocols.
///         Users deposit/withdraw the underlying asset; the vault handles the rest.
contract YieldVault is ERC4626, Ownable, ReentrancyGuard, Pausable {
    using SafeERC20 for IERC20;
    using Math for uint256;

    // ═══════════════════════════════════════════════════════════════
    //  Types
    // ═══════════════════════════════════════════════════════════════

    enum ProtocolType {
        AAVE_V3,        // HyperLend, HypurrFi
        ERC4626_VAULT   // Felix MetaMorpho vaults
    }

    // ═══════════════════════════════════════════════════════════════
    //  Storage
    // ═══════════════════════════════════════════════════════════════

    struct Protocol {
        ProtocolType pType;   // Protocol interface type
        address target;       // Aave V3 Pool address OR ERC-4626 vault address
        address tracker;      // aToken address (Aave) OR vault address itself (ERC-4626)
        bool active;          // Whether new deposits can go here
    }

    Protocol[] public protocols;
    uint256 public activeIndex;  // Which protocol gets new deposits
    address public allocator;    // Authorized to reallocate (the AI agent)

    // ── Fee ──
    uint256 public constant FEE_BPS = 1000;  // 10% management fee (basis points)
    uint256 public constant BPS = 10_000;
    address public feeRecipient;             // Receives fee as vault shares
    uint256 public lastTotalAssets;          // Snapshot for fee calculation

    // ── Safety ──
    uint256 public constant MIN_DEPOSIT = 1000;  // Minimum deposit to prevent first-depositor attack (0.001 USDHL)

    // ═══════════════════════════════════════════════════════════════
    //  Events
    // ═══════════════════════════════════════════════════════════════

    event ProtocolAdded(uint256 indexed index, ProtocolType pType, address target, address tracker);
    event ProtocolToggled(uint256 indexed index, bool active);
    event Reallocated(uint256 indexed from, uint256 indexed to, uint256 amount);
    event AllocatorSet(address indexed allocator);
    event ActiveIndexSet(uint256 indexed index);
    event FeeRecipientSet(address indexed recipient);
    event Harvested(uint256 yield, uint256 feeShares);
    event EmergencyPull(uint256 indexed index, uint256 amount);

    // ═══════════════════════════════════════════════════════════════
    //  Errors
    // ═══════════════════════════════════════════════════════════════

    error Unauthorized();
    error InvalidIndex();
    error NotActive();
    error ZeroAddress();
    error DepositTooSmall();

    // ═══════════════════════════════════════════════════════════════
    //  Modifiers
    // ═══════════════════════════════════════════════════════════════

    modifier auth() {
        if (msg.sender != allocator && msg.sender != owner()) revert Unauthorized();
        _;
    }

    // ═══════════════════════════════════════════════════════════════
    //  Constructor
    // ═══════════════════════════════════════════════════════════════

    /// @param asset_        The underlying token (e.g., USDHL)
    /// @param name_         Vault share token name (e.g., "Yield USDHL")
    /// @param symbol_       Vault share token symbol (e.g., "yUSDHL")
    /// @param owner_        Admin who can add protocols, emergency withdraw
    /// @param allocator_    Address authorized to reallocate (AI agent)
    /// @param feeRecipient_ Address that receives 10% management fee as vault shares
    constructor(
        IERC20 asset_,
        string memory name_,
        string memory symbol_,
        address owner_,
        address allocator_,
        address feeRecipient_
    )
        ERC20(name_, symbol_)
        ERC4626(asset_)
        Ownable(owner_)
    {
        if (allocator_ == address(0)) revert ZeroAddress();
        if (feeRecipient_ == address(0)) revert ZeroAddress();
        allocator = allocator_;
        feeRecipient = feeRecipient_;
    }

    // ═══════════════════════════════════════════════════════════════
    //  Admin Functions
    // ═══════════════════════════════════════════════════════════════

    /// @notice Register a new Aave V3 lending pool
    /// @param pool   The Pool contract address (e.g., HyperLend or HypurrFi)
    /// @param aToken The aToken address for `asset()` on this pool
    function addProtocol(address pool, address aToken) external onlyOwner {
        if (pool == address(0) || aToken == address(0)) revert ZeroAddress();
        protocols.push(Protocol(ProtocolType.AAVE_V3, pool, aToken, true));
        emit ProtocolAdded(protocols.length - 1, ProtocolType.AAVE_V3, pool, aToken);
    }

    /// @notice Register a new ERC-4626 vault (Felix / MetaMorpho)
    /// @param vault4626 The ERC-4626 vault address
    function addVault(address vault4626) external onlyOwner {
        if (vault4626 == address(0)) revert ZeroAddress();
        protocols.push(Protocol(ProtocolType.ERC4626_VAULT, vault4626, vault4626, true));
        emit ProtocolAdded(protocols.length - 1, ProtocolType.ERC4626_VAULT, vault4626, vault4626);
    }

    /// @notice Enable or disable a protocol for new deposits
    function toggleProtocol(uint256 index, bool active) external onlyOwner {
        if (index >= protocols.length) revert InvalidIndex();
        protocols[index].active = active;
        emit ProtocolToggled(index, active);
    }

    /// @notice Set which protocol receives new deposits
    function setActiveIndex(uint256 index) external auth {
        if (index >= protocols.length) revert InvalidIndex();
        if (!protocols[index].active) revert NotActive();
        activeIndex = index;
        emit ActiveIndexSet(index);
    }

    /// @notice Update the allocator address (the AI agent)
    function setAllocator(address newAllocator) external onlyOwner {
        if (newAllocator == address(0)) revert ZeroAddress();
        allocator = newAllocator;
        emit AllocatorSet(newAllocator);
    }

    /// @notice Update the fee recipient address
    function setFeeRecipient(address newRecipient) external onlyOwner {
        if (newRecipient == address(0)) revert ZeroAddress();
        feeRecipient = newRecipient;
        emit FeeRecipientSet(newRecipient);
    }

    /// @notice Pause the vault — disables deposits
    function pause() external onlyOwner {
        _pause();
    }

    /// @notice Unpause the vault
    function unpause() external onlyOwner {
        _unpause();
    }

    /// @notice Collect 10% of yield earned since last harvest as vault shares
    /// @dev    Mints new shares to feeRecipient proportional to the fee amount
    function harvest() external auth nonReentrant {
        uint256 currentTotal = totalAssets();
        if (currentTotal <= lastTotalAssets) {
            lastTotalAssets = currentTotal;
            return; // No yield to collect
        }

        uint256 yield_ = currentTotal - lastTotalAssets;
        uint256 feeAssets = (yield_ * FEE_BPS) / BPS; // 10%

        if (feeAssets > 0 && feeRecipient != address(0)) {
            // Mint vault shares worth `feeAssets` to feeRecipient
            uint256 feeShares = convertToShares(feeAssets);
            if (feeShares > 0) {
                _mint(feeRecipient, feeShares);
                emit Harvested(yield_, feeShares);
            }
        }

        lastTotalAssets = currentTotal;
    }

    // ═══════════════════════════════════════════════════════════════
    //  Core: Reallocate between protocols
    // ═══════════════════════════════════════════════════════════════

    /// @notice Move funds from one protocol to another
    /// @dev    Only callable by allocator or owner
    /// @param from   Protocol index to withdraw from
    /// @param to     Protocol index to deposit into
    /// @param amount Amount of underlying asset to move
    function reallocate(uint256 from, uint256 to, uint256 amount) external auth nonReentrant {
        if (from >= protocols.length || to >= protocols.length) revert InvalidIndex();
        if (!protocols[to].active) revert NotActive();

        _withdrawFrom(from, amount);
        _supplyTo(to, amount);

        emit Reallocated(from, to, amount);
    }

    // ═══════════════════════════════════════════════════════════════
    //  ERC-4626 Overrides
    // ═══════════════════════════════════════════════════════════════

    /// @notice Total assets = idle balance + sum of deployed balances across all protocols
    function totalAssets() public view override returns (uint256 total) {
        total = IERC20(asset()).balanceOf(address(this)); // idle in vault
        for (uint256 i = 0; i < protocols.length; i++) {
            total += _protocolAssets(i);
        }
    }

    /// @dev After pulling tokens from depositor, supply to the active protocol
    function _deposit(
        address caller,
        address receiver,
        uint256 assets,
        uint256 shares
    ) internal override nonReentrant whenNotPaused {
        if (assets < MIN_DEPOSIT) revert DepositTooSmall();

        // Standard ERC4626: pull tokens from caller, mint shares to receiver
        super._deposit(caller, receiver, assets, shares);

        // Track deposit in fee snapshot so new deposits don't count as yield
        lastTotalAssets += assets;

        // If we have an active protocol, deploy the capital immediately
        if (protocols.length > 0 && protocols[activeIndex].active) {
            _supplyTo(activeIndex, assets);
        }
        // Otherwise tokens stay idle in the vault
    }

    /// @dev Before sending tokens to withdrawer, ensure the vault has enough idle balance
    function _withdraw(
        address caller,
        address receiver,
        address _owner,
        uint256 assets,
        uint256 shares
    ) internal override nonReentrant {
        _ensureIdle(assets);
        super._withdraw(caller, receiver, _owner, assets, shares);

        // Adjust fee snapshot so withdrawals don't appear as negative yield
        if (assets <= lastTotalAssets) {
            lastTotalAssets -= assets;
        } else {
            lastTotalAssets = 0;
        }
    }

    /// @dev Pull tokens from protocols until we have `needed` idle balance
    function _ensureIdle(uint256 needed) internal {
        uint256 idle = IERC20(asset()).balanceOf(address(this));
        if (idle >= needed) return;

        uint256 deficit = needed - idle;
        for (uint256 i = 0; i < protocols.length && deficit > 0; i++) {
            uint256 bal = _protocolAssets(i);
            if (bal == 0) continue;
            uint256 pull = bal < deficit ? bal : deficit;
            _withdrawFrom(i, pull);
            deficit -= pull;
        }
    }

    // ═══════════════════════════════════════════════════════════════
    //  Internal Protocol Helpers
    // ═══════════════════════════════════════════════════════════════

    /// @dev Supply `amount` of underlying to protocol at `index`
    function _supplyTo(uint256 index, uint256 amount) internal {
        Protocol storage p = protocols[index];

        if (p.pType == ProtocolType.AAVE_V3) {
            IERC20(asset()).forceApprove(p.target, amount);
            IPool(p.target).supply(asset(), amount, address(this), 0);
        } else {
            // ERC4626_VAULT
            IERC20(asset()).forceApprove(p.target, amount);
            IERC4626Vault(p.target).deposit(amount, address(this));
        }
    }

    /// @dev Withdraw `amount` of underlying from protocol at `index`
    function _withdrawFrom(uint256 index, uint256 amount) internal {
        Protocol storage p = protocols[index];

        if (p.pType == ProtocolType.AAVE_V3) {
            IPool(p.target).withdraw(asset(), amount, address(this));
        } else {
            // ERC4626_VAULT
            IERC4626Vault(p.target).withdraw(amount, address(this), address(this));
        }
    }

    /// @dev Get the underlying asset balance deployed in protocol at `index`
    function _protocolAssets(uint256 index) internal view returns (uint256) {
        Protocol storage p = protocols[index];

        if (p.pType == ProtocolType.AAVE_V3) {
            // aToken balance is 1:1 with underlying (rebasing)
            return IERC20(p.tracker).balanceOf(address(this));
        } else {
            // ERC-4626 vault: convert shares to underlying
            uint256 shares = IERC4626Vault(p.target).balanceOf(address(this));
            if (shares == 0) return 0;
            return IERC4626Vault(p.target).convertToAssets(shares);
        }
    }

    // ═══════════════════════════════════════════════════════════════
    //  View Helpers
    // ═══════════════════════════════════════════════════════════════

    /// @notice Number of registered protocols
    function protocolCount() external view returns (uint256) {
        return protocols.length;
    }

    /// @notice Balance deployed in a specific protocol (in underlying asset units)
    function protocolBalance(uint256 index) external view returns (uint256) {
        if (index >= protocols.length) return 0;
        return _protocolAssets(index);
    }

    // ═══════════════════════════════════════════════════════════════
    //  Emergency
    // ═══════════════════════════════════════════════════════════════

    /// @notice Pull all funds from a protocol back to vault (idle)
    function emergencyPull(uint256 index) external onlyOwner nonReentrant {
        if (index >= protocols.length) revert InvalidIndex();
        uint256 bal = _protocolAssets(index);
        if (bal > 0) {
            _withdrawFrom(index, bal);
            emit EmergencyPull(index, bal);
        }
    }
}
