package com.teasoo.tms

import androidx.test.core.app.ApplicationProvider
import com.teasoo.tms.data.remote.UserDto
import com.teasoo.tms.data.repo.UpdateChecker
import com.teasoo.tms.data.session.SessionState
import com.teasoo.tms.data.session.SessionStore
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

@RunWith(RobolectricTestRunner::class)
class OfflineAccessTest {
    private val context = ApplicationProvider.getApplicationContext<android.content.Context>()
    private val amara = UserDto("u-1", username = "amara", phone = "0803", fullName = "Amara Obi", role = "FIELD_OFFICER")

    @Test
    fun someoneWhoSignedInOnlineBeforeCanSignInWithoutInternet() = runBlocking {
        val store = SessionStore(context)
        store.signOut()
        store.rememberForOffline("Amara ", "s3cret-pass", amara)
        assertNull(store.signInOffline("amara", "wrong"))
        assertFalse(store.knowsOffline("someone-else"))
        // Any of the person's sign-in names works, ignoring case and spaces.
        assertEquals("u-1", store.signInOffline("0803", "s3cret-pass")?.id)
        val state = store.current() as SessionState.Active
        assertEquals("u-1", state.user.id)
        // They can work, but records wait until they sign in online.
        assertTrue(state.needsOnlineSignIn)
    }

    @Test
    fun aServerEndedSessionNeverLocksTheOfficerOut() = runBlocking {
        val store = SessionStore(context)
        store.signOut()
        store.rememberForOffline("amara", "s3cret-pass", amara)
        store.signInOffline("amara", "s3cret-pass")
        store.lock("Your session has ended.")
        val state = store.current()
        assertTrue(state is SessionState.Active)
        assertEquals("Your session has ended.", (state as SessionState.Active).onlineSignInReason)
    }

    @Test
    fun onlyNewerVersionsAreOffered() {
        assertTrue(UpdateChecker.isNewer("1.0.12", "1.0.9"))
        assertFalse(UpdateChecker.isNewer("1.0.9", "1.0.9"))
        assertFalse(UpdateChecker.isNewer("0.9.0", "1.0.0"))
        assertFalse(UpdateChecker.isNewer("latest", "1.0.0"))
    }
}
