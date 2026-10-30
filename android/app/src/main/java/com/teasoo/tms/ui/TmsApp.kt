package com.teasoo.tms.ui

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.navigation.NavType
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import androidx.navigation.navArgument
import com.teasoo.tms.data.session.SessionState
import com.teasoo.tms.ui.admin.adminGraph
import com.teasoo.tms.ui.components.KeyboardAware
import com.teasoo.tms.ui.components.Notice
import com.teasoo.tms.ui.components.PasswordField
import com.teasoo.tms.ui.screens.*

object Routes {
    const val HOME = "home"
    const val REGISTER = "register?replaces={replaces}"
    const val TREES = "trees"
    const val TREE = "tree/{id}"
    const val OBSERVE = "observe/{treeId}?amends={amends}"
    const val EDIT = "edit/{treeId}"
    const val SYNC = "sync"
    const val MAP = "map"
    const val SESSION_SETUP = "session/setup"
    const val SESSION_REGISTER = "session/register"
    const val ADMIN_DASHBOARD = "admin/dashboard"
    const val ADMIN_CONFLICTS = "admin/conflicts"
    const val MY_VISITS = "my-visits"
    fun register(replaces: String? = null) = if (replaces == null) "register" else "register?replaces=$replaces"
    fun tree(id: String) = "tree/$id"
    fun observe(treeId: String, amends: String? = null) = if (amends == null) "observe/$treeId" else "observe/$treeId?amends=$amends"
    fun edit(treeId: String) = "edit/$treeId"
}

@Composable
fun TmsApp(vm: AppViewModel = hiltViewModel()) = KeyboardAware {
    // The app draws edge to edge, so the window does not shrink for the keyboard: every screen is laid out above it
    // instead, and a focused field scrolls into view rather than staying hidden behind the keyboard.
    Box(Modifier.fillMaxSize().imePadding()) {
        when (val s = vm.sessionState.collectAsStateWithLifecycle().value) {
            null -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
            is SessionState.SignedOut -> LoginScreen(vm, prefillEmail = "", reason = null)
            is SessionState.RevalidationRequired -> LoginScreen(vm, prefillEmail = s.user.loginName, reason = s.reason)
            is SessionState.Active -> MainNav(vm)
        }
    }
}

@Composable
private fun MainNav(vm: AppViewModel) {
    val nav = rememberNavController()
    NavHost(nav, startDestination = Routes.HOME) {
        composable(Routes.HOME) { HomeScreen(vm, nav) }
        composable(Routes.REGISTER, arguments = listOf(navArgument("replaces") { type = NavType.StringType; nullable = true })) {
            RegisterScreen(app = vm, onDone = { id -> nav.popBackStack(); nav.navigate(Routes.tree(id)) }, onBack = { nav.popBackStack() })
        }
        composable(Routes.TREES) { TreesScreen(vm, onOpen = { nav.navigate(Routes.tree(it)) }, onBack = { nav.popBackStack() }) }
        composable(Routes.TREE) { TreeDetailScreen(nav, onBack = { nav.popBackStack() }) }
        composable(Routes.OBSERVE, arguments = listOf(navArgument("amends") { type = NavType.StringType; nullable = true })) {
            ObservationScreen(app = vm, onDone = { nav.popBackStack() })
        }
        composable(Routes.EDIT) { EditTreeScreen(app = vm, onDone = { nav.popBackStack() }) }
        composable(Routes.SYNC) { SyncScreen(vm, onOpenTree = { nav.navigate(Routes.tree(it)) }, onBack = { nav.popBackStack() }) }
        composable(Routes.MAP) { AreaMapScreen(vm, onBack = { nav.popBackStack() }) }
        composable(Routes.SESSION_SETUP) { SessionSetupScreen(onStarted = { nav.popBackStack(Routes.HOME, inclusive = false) }, onBack = { nav.popBackStack() }) }
        composable(Routes.SESSION_REGISTER) { RapidRegisterScreen(onBack = { nav.popBackStack() }, onVisitTree = { nav.navigate(Routes.observe(it)) }) }
        composable(Routes.ADMIN_DASHBOARD) { DashboardScreen(vm, onBack = { nav.popBackStack() }) }
        composable(Routes.ADMIN_CONFLICTS) { ConflictsScreen(onOpenTree = { nav.navigate(Routes.tree(it)) }, onBack = { nav.popBackStack() }) }
        composable(Routes.MY_VISITS) { MyVisitsScreen(onOpenTree = { nav.navigate(Routes.tree(it)) }, onBack = { nav.popBackStack() }) }
        adminGraph(nav, onOpenTree = { nav.navigate(Routes.tree(it)) })
    }
}

@Composable
private fun LoginScreen(vm: AppViewModel, prefillEmail: String, reason: String?) {
    var email by remember(prefillEmail) { mutableStateOf(prefillEmail) }
    var password by remember { mutableStateOf("") }
    val error by vm.loginError.collectAsStateWithLifecycle()
    val busy by vm.loggingIn.collectAsStateWithLifecycle()
    Scaffold { padding ->
        Column(
            Modifier.padding(padding).padding(24.dp).fillMaxSize(),
            verticalArrangement = Arrangement.spacedBy(16.dp, Alignment.CenterVertically),
        ) {
            Text("TMS Field", style = MaterialTheme.typography.headlineMedium)
            Text("The first sign-in on this device needs internet. After that you can sign in and work offline.", style = MaterialTheme.typography.bodyMedium)
            reason?.let { Notice("$it Records on this device are kept and will sync after you sign in.") }
            OutlinedTextField(email, { email = it }, label = { Text("Username, email or phone") }, singleLine = true,
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Text, autoCorrectEnabled = false), modifier = Modifier.fillMaxWidth())
            PasswordField(password, { password = it }, "Password")
            error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
            Button(onClick = { vm.login(email, password) }, enabled = !busy && email.isNotBlank() && password.isNotBlank(), modifier = Modifier.fillMaxWidth()) {
                Text(if (busy) "Signing in…" else "Sign in")
            }
        }
    }
}
