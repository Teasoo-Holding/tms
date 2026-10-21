package com.teasoo.tms.ui.components

import android.Manifest
import android.content.pm.PackageManager
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageCapture
import androidx.camera.core.ImageCaptureException
import androidx.camera.core.Preview
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.PhotoCamera
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalLifecycleOwner
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.core.content.ContextCompat
import com.teasoo.tms.data.repo.CapturedPhoto
import com.teasoo.tms.data.repo.PhotoStore
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/**
 * Full-screen CameraX capture into app-private storage. Reports camera or storage failures
 * instead of crashing, so the officer can still save the record and add photos later.
 */
@Composable
fun CameraCaptureDialog(photoStore: PhotoStore, onCaptured: (CapturedPhoto) -> Unit, onDismiss: () -> Unit) {
    val context = LocalContext.current
    val lifecycleOwner = LocalLifecycleOwner.current
    var granted by remember { mutableStateOf(ContextCompat.checkSelfPermission(context, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) }
    val launcher = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted = it }
    var error by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    val imageCapture = remember { ImageCapture.Builder().setCaptureMode(ImageCapture.CAPTURE_MODE_MINIMIZE_LATENCY).build() }
    val lowStorage = photoStore.freeBytes() < PhotoStore.CRITICAL_STORAGE_BYTES

    LaunchedEffect(Unit) { if (!granted) launcher.launch(Manifest.permission.CAMERA) }

    // Edge to edge, with the controls kept clear of the status and navigation bars on every phone size.
    Dialog(onDismissRequest = onDismiss, properties = DialogProperties(usePlatformDefaultWidth = false, decorFitsSystemWindows = false)) {
        Box(Modifier.fillMaxSize().background(Color.Black)) {
            when {
                lowStorage -> Text("The device is almost full. Free up space before taking photos.", Modifier.align(Alignment.Center).padding(24.dp), color = Color.White)
                !granted -> Text("Camera permission is needed to take photos.", Modifier.align(Alignment.Center).padding(24.dp), color = Color.White)
                else -> AndroidView(
                    modifier = Modifier.fillMaxSize(),
                    factory = { ctx ->
                        PreviewView(ctx).also { view ->
                            view.scaleType = PreviewView.ScaleType.FIT_CENTER
                            val future = ProcessCameraProvider.getInstance(ctx)
                            future.addListener({
                                runCatching {
                                    val provider = future.get()
                                    val preview = Preview.Builder().build().also { it.surfaceProvider = view.surfaceProvider }
                                    provider.unbindAll()
                                    provider.bindToLifecycle(lifecycleOwner, CameraSelector.DEFAULT_BACK_CAMERA, preview, imageCapture)
                                }.onFailure { error = "The camera could not be started: ${it.message}" }
                            }, ContextCompat.getMainExecutor(ctx))
                        }
                    },
                )
            }
            IconButton(onClick = onDismiss, modifier = Modifier.align(Alignment.TopStart).statusBarsPadding().padding(8.dp)) {
                Icon(Icons.Default.Close, contentDescription = "Close camera", tint = Color.White)
            }
            Column(
                Modifier.align(Alignment.BottomCenter).fillMaxWidth().background(Color.Black.copy(alpha = 0.45f)).navigationBarsPadding().padding(vertical = 16.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                error?.let { Text(it, color = Color(0xFFFFB4AB), modifier = Modifier.padding(horizontal = 16.dp)) }
                // A large round shutter button, always above the navigation bar.
                Surface(
                    onClick = {
                        busy = true
                        val (id, file) = photoStore.newFile()
                        imageCapture.takePicture(
                            ImageCapture.OutputFileOptions.Builder(file).build(),
                            ContextCompat.getMainExecutor(context),
                            object : ImageCapture.OnImageSavedCallback {
                                override fun onImageSaved(output: ImageCapture.OutputFileResults) {
                                    // Resizing a full-resolution capture takes a moment; keep the UI responsive.
                                    scope.launch {
                                        val photo = withContext(Dispatchers.IO) { photoStore.finalize(id, file) }
                                        busy = false
                                        onCaptured(photo)
                                    }
                                }
                                override fun onError(exception: ImageCaptureException) {
                                    busy = false
                                    file.delete()
                                    error = "The photo could not be saved: ${exception.message}"
                                }
                            },
                        )
                    },
                    enabled = granted && !busy && !lowStorage,
                    shape = CircleShape,
                    color = Color.White,
                    border = BorderStroke(4.dp, Color.White.copy(alpha = 0.5f)),
                    modifier = Modifier.size(76.dp).semantics { contentDescription = "Take photo" },
                ) {
                    Box(contentAlignment = Alignment.Center) {
                        if (busy) CircularProgressIndicator(Modifier.size(32.dp)) else Icon(Icons.Default.PhotoCamera, contentDescription = null, tint = Color.Black)
                    }
                }
                Text(if (busy) "Saving…" else "Tap to take the photo", color = Color.White, style = MaterialTheme.typography.labelMedium)
            }
        }
    }
}
