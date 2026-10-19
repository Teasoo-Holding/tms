package com.teasoo.tms.domain

import kotlin.math.min
import kotlin.random.Random

/** Exponential backoff with full jitter for per-item retries (outbox operations, photo uploads). */
object Backoff {
    private const val BASE_MS = 30_000L
    private const val MAX_MS = 6 * 60 * 60_000L

    fun delayMs(attempts: Int, random: Random = Random.Default): Long {
        val ceiling = min(MAX_MS, BASE_MS shl min(attempts, 20).coerceAtLeast(0))
        return random.nextLong(BASE_MS / 2, ceiling.coerceAtLeast(BASE_MS / 2 + 1))
    }
}
