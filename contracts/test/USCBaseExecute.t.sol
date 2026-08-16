// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import {USCBase} from "../src/base/USCBase.sol";
import {INativeQueryVerifier} from "../src/interfaces/INativeQueryVerifier.sol";
import {Index41Base} from "./helpers/Index41Base.sol";

/**
 * @title PassThroughASC
 * @notice The smallest possible concrete {USCBase}: unlike Index41, it does not close the
 *         generic {USCBase-execute} path — its hook just emits what it was given. That is the
 *         entire point of this contract: Index41MechanismTest proves the generic path is
 *         deliberately closed for the real product, which as a side effect means no Index41
 *         test can ever reach USCBase's own success return or drive its guards to both
 *         outcomes. This probe exists only to reach the code Index41 exists to avoid.
 */
contract PassThroughASC is USCBase {
    event Executed(uint8 action, bytes32 queryId, bytes encodedTransaction);

    function _processAndEmitEvent(uint8 action, bytes32 queryId, bytes memory encodedTransaction) internal override {
        emit Executed(action, queryId, encodedTransaction);
    }
}

/**
 * @title USCBaseExecuteTest
 * @notice Drives {USCBase-execute} directly through {PassThroughASC}: the happy path (burns the
 *         query id, calls the hook, returns true), the replay guard, and the verification guard.
 */
contract USCBaseExecuteTest is Index41Base {
    PassThroughASC internal probe;

    function setUp() public override {
        super.setUp();
        probe = new PassThroughASC();
    }

    function test_ExecuteHappyPath_ReturnsTrueAndBurnsTheQueryId() public {
        bytes32 id = queryId(CHAIN_KEY_MAINNET, HEIGHT, 15);
        assertFalse(probe.processedQueries(id), "starts unburned");

        vm.expectEmit(false, false, false, true, address(probe));
        emit PassThroughASC.Executed(7, id, hex"00");

        bool ok = probe.execute(
            7, CHAIN_KEY_MAINNET, HEIGHT, hex"00", ROOT, pathFor(15), keccak256("lower"), _continuityRoots()
        );

        assertTrue(ok, "execute reports success");
        assertTrue(probe.processedQueries(id), "the query id is burned on success");
    }

    function test_ExecuteRevertsWhenQueryAlreadyProcessed() public {
        probe.execute(0, CHAIN_KEY_MAINNET, HEIGHT, hex"00", ROOT, pathFor(15), keccak256("lower"), _continuityRoots());

        vm.expectRevert(bytes("Query already processed"));
        probe.execute(0, CHAIN_KEY_MAINNET, HEIGHT, hex"00", ROOT, pathFor(15), keccak256("lower"), _continuityRoots());
    }

    function test_ExecuteRevertsWhenVerificationFails() public {
        // Attesting a different height means (chainKey, HEIGHT, ROOT) is unattested, so the
        // mock reports false rather than reverting outright.
        verifier.attest(CHAIN_KEY_MAINNET, HEIGHT + 1, ROOT);

        vm.expectRevert(bytes("Proof of inclusion verification failed"));
        probe.execute(0, CHAIN_KEY_MAINNET, HEIGHT, hex"00", ROOT, pathFor(15), keccak256("lower"), _continuityRoots());
    }

    function test_FailedVerificationDoesNotBurnTheQueryId() public {
        verifier.attest(CHAIN_KEY_MAINNET, HEIGHT + 1, ROOT);
        bytes32 id = queryId(CHAIN_KEY_MAINNET, HEIGHT, 15);

        vm.expectRevert(bytes("Proof of inclusion verification failed"));
        probe.execute(0, CHAIN_KEY_MAINNET, HEIGHT, hex"00", ROOT, pathFor(15), keccak256("lower"), _continuityRoots());

        assertFalse(probe.processedQueries(id), "a failed verification must not consume the replay namespace");
    }
}
