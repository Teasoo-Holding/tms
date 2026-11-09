package com.teasoo.tms.ui.components

import android.app.Activity
import android.content.Context
import android.content.ContextWrapper
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.credentials.CredentialManager
import androidx.credentials.CustomCredential
import androidx.credentials.GetCredentialRequest
import androidx.credentials.exceptions.GetCredentialCancellationException
import androidx.credentials.exceptions.GetCredentialException
import androidx.credentials.exceptions.NoCredentialException
import com.google.android.libraries.identity.googleid.GetSignInWithGoogleOption
import com.google.android.libraries.identity.googleid.GoogleIdTokenCredential
import kotlinx.coroutines.launch

private tailrec fun Context.activity(): Activity? = when (this) {
    is Activity -> this
    is ContextWrapper -> baseContext.activity()
    else -> null
}

/**
 * "Sign in with Google" through Android's Credential Manager. [clientId] is the server's web client id, so the
 * ID token's audience is what the server checks. [onToken] gets the ID token; [onError] a message to show.
 */
@Composable
fun GoogleSignInButton(clientId: String, enabled: Boolean, onToken: (String) -> Unit, onError: (String?) -> Unit) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            HorizontalDivider(Modifier.weight(1f))
            Text("or", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
            HorizontalDivider(Modifier.weight(1f))
        }
        OutlinedButton(
            onClick = {
                val activity = context.activity() ?: return@OutlinedButton
                onError(null)
                scope.launch {
                    try {
                        val request = GetCredentialRequest.Builder().addCredentialOption(GetSignInWithGoogleOption.Builder(clientId).build()).build()
                        val credential = CredentialManager.create(activity).getCredential(activity, request).credential
                        if (credential is CustomCredential && credential.type == GoogleIdTokenCredential.TYPE_GOOGLE_ID_TOKEN_CREDENTIAL) {
                            onToken(GoogleIdTokenCredential.createFrom(credential.data).idToken)
                        } else {
                            onError("Google sign-in did not work. Sign in with your password instead.")
                        }
                    } catch (e: GetCredentialCancellationException) {
                        onError("Google sign-in was cancelled. You can sign in with your password instead.")
                    } catch (e: NoCredentialException) {
                        onError("There is no Google account on this phone. Add one in Settings, or sign in with your password.")
                    } catch (e: GetCredentialException) {
                        onError("Google sign-in did not work. Check your internet, or sign in with your password.")
                    }
                }
            },
            enabled = enabled,
            modifier = Modifier.fillMaxWidth().heightIn(min = 52.dp),
        ) { Text("Sign in with Google") }
        Text("Use the Google account with the same email as your TMS account. Google sign-in needs internet.",
            style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}
