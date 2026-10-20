package com.teasoo.tms.di

import com.teasoo.tms.BuildConfig
import com.teasoo.tms.data.remote.AdminApi
import com.teasoo.tms.data.remote.TmsJson
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import retrofit2.Retrofit
import retrofit2.converter.kotlinx.serialization.asConverterFactory
import javax.inject.Singleton

/** Online administration API: same base URL, JSON settings and authenticated client as [AppModule.api]. */
@Module
@InstallIn(SingletonComponent::class)
object AdminModule {
    @Provides @Singleton
    fun adminApi(client: OkHttpClient): AdminApi = Retrofit.Builder()
        .baseUrl(BuildConfig.API_BASE_URL)
        .client(client)
        .addConverterFactory(TmsJson.asConverterFactory("application/json".toMediaType()))
        .build()
        .create(AdminApi::class.java)
}
