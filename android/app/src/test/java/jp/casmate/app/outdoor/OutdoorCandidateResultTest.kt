package jp.casmate.app.outdoor

import org.junit.Assert.assertEquals
import org.junit.Test

class OutdoorCandidateResultTest {
    @Test fun authenticationFailureSurvivesFollowingCandidateTimeouts() {
        val result = listOf(-2, -1, -1).fold(-1, ::aggregateOutdoorCandidateResult)
        assertEquals(-2, result)
    }
    @Test fun aLaterSuccessfulCandidateOverridesPreviousAuthenticationFailures() {
        val result = listOf(-2, -1, 1).fold(-1, ::aggregateOutdoorCandidateResult)
        assertEquals(1, result)
    }
    @Test fun networkFailuresDoNotClaimAnAuthenticationFailure() {
        val result = listOf(-1, -1).fold(-1, ::aggregateOutdoorCandidateResult)
        assertEquals(-1, result)
    }
}
