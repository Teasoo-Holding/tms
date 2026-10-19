package com.teasoo.tms

import com.teasoo.tms.domain.TreeIdAssembler
import kotlinx.serialization.json.*
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test

/** Runs the same vectors as the backend (spec/tree-id-test-vectors.json). */
class TreeIdAssemblerTest {
    private val vectors = Json.parseToJsonElement(javaClass.classLoader!!.getResource("tree-id-test-vectors.json")!!.readText()).jsonObject
    private val entities = vectors["entities"]!!.jsonObject.let {
        TreeIdAssembler.ScopeEntities(it.s("project"), it.s("plantingYear"), it.s("vendor"), it.s("sector"), it.s("subSector"))
    }

    private fun JsonObject.s(k: String) = this[k]!!.jsonPrimitive.content
    private fun scheme(o: JsonObject) = TreeIdAssembler.Scheme(
        separator = o.s("separator"),
        serialWidth = o["serialWidth"]!!.jsonPrimitive.int,
        components = o["components"]!!.jsonArray.map { c -> TreeIdAssembler.Component(c.jsonObject.s("type"), c.jsonObject["required"]!!.jsonPrimitive.boolean) },
        serialUniquenessScope = o["serialUniquenessScope"]!!.jsonArray.map { it.jsonPrimitive.content },
    )
    private fun values(o: JsonObject) = o.mapValues { it.value.jsonPrimitive.content }

    @Test
    fun assemblesSharedVectors() {
        for (v in vectors["assemble"]!!.jsonArray.map { it.jsonObject }) {
            val scheme = scheme(v["scheme"]!!.jsonObject)
            val expected = v["expected"]!!.jsonObject
            val result = TreeIdAssembler.assemble(scheme, values(v["values"]!!.jsonObject), v.s("serialInput"))
            assertEquals(v.s("name"), expected.s("prefix"), result.prefix)
            assertEquals(v.s("name"), expected.s("serial"), result.serial)
            assertEquals(v.s("name"), expected.s("physicalId"), result.physicalId)
            assertEquals(v.s("name"), expected.s("normalized"), result.normalized)
            assertEquals(v.s("name"), expected.s("serialScopeKey"), TreeIdAssembler.serialScopeKey(scheme.serialUniquenessScope, entities))
        }
    }

    @Test
    fun rejectsInvalidSerials() {
        for (v in vectors["serialErrors"]!!.jsonArray.map { it.jsonObject }) {
            val e = assertThrows(TreeIdAssembler.TreeIdException::class.java) {
                TreeIdAssembler.normalizeSerial(v.s("input"), v["serialWidth"]!!.jsonPrimitive.int)
            }
            assertEquals("input ${v.s("input")}", v.s("error"), e.code)
        }
    }

    @Test
    fun requiresMandatoryComponents() {
        val v = vectors["missingComponent"]!!.jsonObject
        val e = assertThrows(TreeIdAssembler.TreeIdException::class.java) {
            TreeIdAssembler.assemble(scheme(v["scheme"]!!.jsonObject), values(v["values"]!!.jsonObject), "1")
        }
        assertEquals(v.s("error"), e.code)
    }

    @Test
    fun normalisesLikeTheServer() {
        for (v in vectors["normalize"]!!.jsonArray.map { it.jsonObject }) {
            assertEquals(v.s("expected"), TreeIdAssembler.normalize(v.s("input")))
        }
    }
}
