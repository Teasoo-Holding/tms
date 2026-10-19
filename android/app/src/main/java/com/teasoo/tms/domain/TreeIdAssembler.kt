package com.teasoo.tms.domain

/**
 * Tree ID composition rules. Mirrors backend/src/domain/tree-id.ts; both are tested against
 * spec/tree-id-test-vectors.json so the device and server always assemble the same ID.
 */
object TreeIdAssembler {
    val SCOPE_DIMENSIONS = listOf("PROJECT", "PLANTING_YEAR", "VENDOR", "SECTOR", "SUB_SECTOR")
    private val DASH_VARIANTS = Regex("[\\u2010-\\u2015\\u2212\\uFE58\\uFE63\\uFF0D]")
    private val WHITESPACE = Regex("\\s+")
    private val DIGITS = Regex("^[0-9]+$")
    private val ZEROS = Regex("^0+$")

    data class Component(val type: String, val required: Boolean)

    data class Scheme(
        val separator: String,
        val serialWidth: Int,
        val components: List<Component>,
        /** Empty means serials are unique globally. */
        val serialUniquenessScope: List<String>,
    )

    data class ScopeEntities(
        val project: String,
        val plantingYear: String,
        val vendor: String?,
        val sector: String,
        val subSector: String,
    )

    data class Assembled(val prefix: String, val serial: String, val physicalId: String, val normalized: String)

    class TreeIdException(val code: String) : IllegalArgumentException(code)

    /** Read-only prefix shown to the officer before they type the serial. */
    fun prefix(scheme: Scheme, values: Map<String, String?>): String {
        val parts = scheme.components.filter { it.type != "SERIAL" }.mapNotNull { c ->
            val v = values[c.type]?.trim().orEmpty()
            when {
                v.isNotEmpty() -> v.uppercase()
                c.required -> throw TreeIdException("COMPONENT_MISSING:${c.type}")
                else -> null
            }
        }
        return if (parts.isEmpty()) "" else parts.joinToString(scheme.separator) + scheme.separator
    }

    fun normalizeSerial(input: String, width: Int): String {
        val trimmed = input.trim()
        if (trimmed.isEmpty()) throw TreeIdException("SERIAL_REQUIRED")
        if (!DIGITS.matches(trimmed)) throw TreeIdException("SERIAL_NOT_NUMERIC")
        if (trimmed.length > width) throw TreeIdException("SERIAL_TOO_LONG")
        if (ZEROS.matches(trimmed)) throw TreeIdException("SERIAL_ZERO")
        return trimmed.padStart(width, '0')
    }

    fun assemble(scheme: Scheme, values: Map<String, String?>, serialInput: String): Assembled {
        val prefix = prefix(scheme, values)
        val serial = normalizeSerial(serialInput, scheme.serialWidth)
        val id = prefix + serial
        return Assembled(prefix, serial, id, normalize(id))
    }

    fun normalize(id: String): String = id.replace(DASH_VARIANTS, "-").replace(WHITESPACE, "").uppercase()

    fun serialScopeKey(scope: List<String>, e: ScopeEntities): String {
        if (scope.isEmpty()) return "GLOBAL"
        val lookup = mapOf(
            "PROJECT" to e.project,
            "PLANTING_YEAR" to e.plantingYear,
            "VENDOR" to (e.vendor ?: "NONE"),
            "SECTOR" to e.sector,
            "SUB_SECTOR" to e.subSector,
        )
        return scope.sorted().joinToString("|") { "$it=${lookup.getValue(it)}" }
    }

    /** Officer-facing explanation for an assembly error. */
    fun message(code: String): String = when {
        code == "SERIAL_REQUIRED" -> "Enter the serial number from the label."
        code == "SERIAL_NOT_NUMERIC" -> "The serial number may contain digits only."
        code == "SERIAL_TOO_LONG" -> "The serial has more digits than this ID format allows."
        code == "SERIAL_ZERO" -> "The serial number cannot be zero."
        code.startsWith("COMPONENT_MISSING:") -> when (code.substringAfter(':')) {
            "VENDOR_CODE" -> "Choose a vendor; it is part of this ID format."
            "SECTOR_CODE", "SUB_SECTOR_CODE" -> "Choose the sector and sub-sector."
            else -> "Some ID parts are missing. Sync to refresh project settings."
        }
        else -> "The tree ID could not be assembled."
    }
}
