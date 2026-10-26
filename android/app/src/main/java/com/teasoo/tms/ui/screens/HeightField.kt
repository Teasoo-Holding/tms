package com.teasoo.tms.ui.screens

import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.ViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import com.teasoo.tms.data.repo.FieldSessionRepository
import com.teasoo.tms.data.repo.HeightReading
import com.teasoo.tms.ui.components.HeightInput
import com.teasoo.tms.ui.components.HeightUnit
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject

@HiltViewModel
class HeightUnitViewModel @Inject constructor(private val sessions: FieldSessionRepository) : ViewModel() {
    val unit = MutableStateFlow(HeightUnit.CM)
    init { viewModelScope.launch { unit.value = HeightUnit.of(sessions.heightUnit()) } }
    fun set(u: HeightUnit) { unit.value = u; viewModelScope.launch { sessions.setHeightUnit(u.code) } }
}

/** Optional typed-in tree height, in the officer's remembered unit; stored in centimetres. */
@Composable
fun HeightField(height: HeightReading?, onChange: (HeightReading?) -> Unit, vm: HeightUnitViewModel = hiltViewModel()) {
    val unit by vm.unit.collectAsStateWithLifecycle()
    HeightInput(height?.cm, { cm -> onChange(cm?.let { HeightReading(it, "MANUAL") }) }, unit, vm::set)
}
