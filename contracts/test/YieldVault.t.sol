// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "../src/YieldVault.sol";

// ═══════════════════════════════════════════════════════════════
//  Mock Contracts
// ═══════════════════════════════════════════════════════════════

/// @dev Mintable ERC20 for testing
contract MockToken is ERC20 {
    uint8 private _dec;

    constructor(string memory n, string memory s, uint8 d) ERC20(n, s) {
        _dec = d;
    }

    function decimals() public view override returns (uint8) {
        return _dec;
    }

    function mint(address to, uint256 a) external {
        _mint(to, a);
    }
}

/// @dev Mock aToken — pool can mint/burn
contract MockAToken is ERC20 {
    address public pool;

    constructor(address pool_) ERC20("aToken", "aT") {
        pool = pool_;
    }

    function mint(address to, uint256 a) external {
        require(msg.sender == pool, "only pool");
        _mint(to, a);
    }

    function burn(address from, uint256 a) external {
        require(msg.sender == pool, "only pool");
        _burn(from, a);
    }
}

/// @dev Mock Aave V3 Pool — supply mints aTokens, withdraw burns them
contract MockPool {
    IERC20 public token;
    MockAToken public aToken;

    constructor(IERC20 t) {
        token = t;
        aToken = new MockAToken(address(this));
    }

    function supply(address, uint256 amount, address onBehalfOf, uint16) external {
        token.transferFrom(msg.sender, address(this), amount);
        aToken.mint(onBehalfOf, amount);
    }

    function withdraw(address, uint256 amount, address to) external returns (uint256) {
        aToken.burn(msg.sender, amount);
        token.transfer(to, amount);
        return amount;
    }

    /// @dev Simulate interest accrual by minting extra aTokens to a user
    function accrueInterest(address user, uint256 extra) external {
        // Mint underlying to pool so it can pay out later
        // (In tests we pre-fund the pool)
        aToken.mint(user, extra);
    }
}

// ═══════════════════════════════════════════════════════════════
//  Test Suite
// ═══════════════════════════════════════════════════════════════

contract YieldVaultTest is Test {
    MockToken token;
    MockPool pool1;
    MockPool pool2;
    YieldVault vault;

    address owner = address(this);
    address allocator = address(0xA110);
    address user = address(0xBEEF);
    address user2 = address(0xCAFE);

    function setUp() public {
        // Deploy mock underlying token (USDHL, 6 decimals)
        token = new MockToken("USDHL", "USDHL", 6);

        // Deploy two mock Aave V3 pools
        pool1 = new MockPool(IERC20(address(token)));
        pool2 = new MockPool(IERC20(address(token)));

        // Fund pools with tokens so they can pay withdrawals
        token.mint(address(pool1), 10_000_000e6);
        token.mint(address(pool2), 10_000_000e6);

        // Deploy the yield vault
        vault = new YieldVault(
            IERC20(address(token)),
            "Yield USDHL",
            "yUSDHL",
            owner,
            allocator
        );

        // Register both protocols
        vault.addProtocol(address(pool1), address(pool1.aToken()));
        vault.addProtocol(address(pool2), address(pool2.aToken()));

        // Fund users
        token.mint(user, 10_000e6);
        token.mint(user2, 10_000e6);

        // Approve vault
        vm.prank(user);
        token.approve(address(vault), type(uint256).max);
        vm.prank(user2);
        token.approve(address(vault), type(uint256).max);
    }

    // ─── Deposit Tests ───

    function test_deposit_mints_shares() public {
        vm.prank(user);
        vault.deposit(100e6, user);

        assertGt(vault.balanceOf(user), 0, "Should receive shares");
        assertEq(vault.totalAssets(), 100e6, "Total assets should be 100");
    }

    function test_deposit_supplies_to_active_protocol() public {
        vm.prank(user);
        vault.deposit(100e6, user);

        assertEq(vault.protocolBalance(0), 100e6, "Pool1 should have 100");
        assertEq(vault.protocolBalance(1), 0, "Pool2 should have 0");
    }

    function test_deposit_to_second_protocol() public {
        // Switch active to pool2
        vm.prank(allocator);
        vault.setActiveIndex(1);

        vm.prank(user);
        vault.deposit(100e6, user);

        assertEq(vault.protocolBalance(0), 0, "Pool1 should have 0");
        assertEq(vault.protocolBalance(1), 100e6, "Pool2 should have 100");
    }

    // ─── Withdraw Tests ───

    function test_withdraw_returns_tokens() public {
        vm.prank(user);
        vault.deposit(100e6, user);

        vm.prank(user);
        vault.withdraw(50e6, user, user);

        assertEq(token.balanceOf(user), 9_950e6, "User should have 9950");
        assertEq(vault.totalAssets(), 50e6, "Vault should have 50 left");
    }

    function test_full_withdraw() public {
        vm.prank(user);
        vault.deposit(100e6, user);

        uint256 shares = vault.balanceOf(user);
        vm.prank(user);
        vault.redeem(shares, user, user);

        assertEq(token.balanceOf(user), 10_000e6, "User should have all tokens back");
        assertEq(vault.totalAssets(), 0, "Vault should be empty");
    }

    function test_withdraw_across_protocols() public {
        // Deposit 100 to pool1
        vm.prank(user);
        vault.deposit(100e6, user);

        // Reallocate 60 to pool2
        vm.prank(allocator);
        vault.reallocate(0, 1, 60e6);

        // Withdraw 80 — needs to pull from both pools
        vm.prank(user);
        vault.withdraw(80e6, user, user);

        assertEq(vault.totalAssets(), 20e6, "Should have 20 left");
        assertEq(token.balanceOf(user), 9_980e6, "User gets 80 back");
    }

    // ─── Reallocate Tests ───

    function test_reallocate() public {
        vm.prank(user);
        vault.deposit(100e6, user);

        vm.prank(allocator);
        vault.reallocate(0, 1, 60e6);

        assertEq(vault.protocolBalance(0), 40e6, "Pool1 should have 40");
        assertEq(vault.protocolBalance(1), 60e6, "Pool2 should have 60");
        assertEq(vault.totalAssets(), 100e6, "Total unchanged");
    }

    function test_reallocate_full_amount() public {
        vm.prank(user);
        vault.deposit(100e6, user);

        vm.prank(allocator);
        vault.reallocate(0, 1, 100e6);

        assertEq(vault.protocolBalance(0), 0, "Pool1 empty");
        assertEq(vault.protocolBalance(1), 100e6, "Pool2 has all");
    }

    function test_reallocate_unauthorized() public {
        vm.prank(user);
        vault.deposit(100e6, user);

        vm.prank(user); // not allocator or owner
        vm.expectRevert(YieldVault.Unauthorized.selector);
        vault.reallocate(0, 1, 50e6);
    }

    function test_reallocate_owner_allowed() public {
        vm.prank(user);
        vault.deposit(100e6, user);

        // Owner should also be able to reallocate
        vault.reallocate(0, 1, 50e6);

        assertEq(vault.protocolBalance(0), 50e6);
        assertEq(vault.protocolBalance(1), 50e6);
    }

    // ─── Total Assets / Interest Tests ───

    function test_totalAssets_includes_all_protocols() public {
        vm.prank(user);
        vault.deposit(100e6, user);

        vm.prank(allocator);
        vault.reallocate(0, 1, 30e6);

        // 70 in pool1 + 30 in pool2 = 100
        assertEq(vault.totalAssets(), 100e6);
    }

    function test_interest_accrual_increases_totalAssets() public {
        vm.prank(user);
        vault.deposit(100e6, user);

        // Simulate 5% interest (5 USDHL)
        token.mint(address(pool1), 5e6); // pool needs underlying to pay
        pool1.accrueInterest(address(vault), 5e6);

        assertEq(vault.totalAssets(), 105e6, "Should reflect interest");
    }

    function test_interest_shared_proportionally() public {
        // User1 deposits 100
        vm.prank(user);
        vault.deposit(100e6, user);

        // User2 deposits 100
        vm.prank(user2);
        vault.deposit(100e6, user2);

        // Simulate 10 USDHL interest
        token.mint(address(pool1), 10e6);
        pool1.accrueInterest(address(vault), 10e6);

        assertEq(vault.totalAssets(), 210e6, "Total should be 210");

        // Each user should get ~105 back (50/50 share)
        uint256 user1Assets = vault.convertToAssets(vault.balanceOf(user));
        uint256 user2Assets = vault.convertToAssets(vault.balanceOf(user2));
        assertApproxEqAbs(user1Assets, 105e6, 1, "User1 gets ~105");
        assertApproxEqAbs(user2Assets, 105e6, 1, "User2 gets ~105");
    }

    // ─── Admin Tests ───

    function test_addProtocol() public {
        MockPool pool3 = new MockPool(IERC20(address(token)));
        vault.addProtocol(address(pool3), address(pool3.aToken()));
        assertEq(vault.protocolCount(), 3);
    }

    function test_toggleProtocol() public {
        vault.toggleProtocol(0, false);
        (,, bool active) = vault.protocols(0);
        assertFalse(active);
    }

    function test_setActiveIndex_to_inactive_reverts() public {
        vault.toggleProtocol(0, false);

        vm.prank(allocator);
        vm.expectRevert(YieldVault.NotActive.selector);
        vault.setActiveIndex(0);
    }

    function test_setAllocator() public {
        address newAllocator = address(0x1234);
        vault.setAllocator(newAllocator);
        assertEq(vault.allocator(), newAllocator);
    }

    // ─── Emergency Tests ───

    function test_emergencyPull() public {
        vm.prank(user);
        vault.deposit(100e6, user);

        vault.emergencyPull(0);

        assertEq(vault.protocolBalance(0), 0, "Pool1 should be empty");
        assertEq(token.balanceOf(address(vault)), 100e6, "Vault has idle");
        assertEq(vault.totalAssets(), 100e6, "Total unchanged");
    }

    function test_emergencyPull_only_owner() public {
        vm.prank(user);
        vault.deposit(100e6, user);

        vm.prank(allocator);
        vm.expectRevert();
        vault.emergencyPull(0);
    }

    // ─── Multiple Deposits / Withdraws ───

    function test_multiple_operations() public {
        vm.startPrank(user);
        vault.deposit(50e6, user);
        vault.deposit(30e6, user);
        vault.withdraw(20e6, user, user);
        vm.stopPrank();

        assertEq(vault.totalAssets(), 60e6);
        assertEq(token.balanceOf(user), 9_940e6);
    }

    // ─── Edge Cases ───

    function test_deposit_with_no_protocols() public {
        // Deploy a fresh vault with no protocols
        YieldVault fresh = new YieldVault(
            IERC20(address(token)),
            "Fresh",
            "FRESH",
            owner,
            allocator
        );

        token.mint(address(0xDEAD), 100e6);
        vm.startPrank(address(0xDEAD));
        token.approve(address(fresh), type(uint256).max);
        fresh.deposit(100e6, address(0xDEAD));
        vm.stopPrank();

        // Tokens stay idle in vault
        assertEq(token.balanceOf(address(fresh)), 100e6);
        assertEq(fresh.totalAssets(), 100e6);
    }

    function test_protocolBalance_out_of_range() public {
        assertEq(vault.protocolBalance(999), 0);
    }

    function test_invalid_index_reverts() public {
        vm.expectRevert(YieldVault.InvalidIndex.selector);
        vault.toggleProtocol(999, true);
    }
}
