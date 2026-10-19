package com.teasoo.tms.di

import android.content.Context
import androidx.room.Room
import com.teasoo.tms.BuildConfig
import com.teasoo.tms.data.local.TmsDatabase
import com.teasoo.tms.data.remote.AuthInterceptor
import com.teasoo.tms.data.remote.TmsApi
import com.teasoo.tms.data.remote.TmsJson
import com.teasoo.tms.data.remote.TokenAuthenticator
import com.teasoo.tms.data.session.SessionStore
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.android.qualifiers.ApplicationContext
import dagger.hilt.components.SingletonComponent
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import retrofit2.Retrofit
import retrofit2.converter.kotlinx.serialization.asConverterFactory
import java.util.concurrent.TimeUnit
import javax.inject.Named
import javax.inject.Singleton

@Module
@InstallIn(SingletonComponent::class)
object AppModule {
    @Provides @Singleton
    fun database(@ApplicationContext context: Context): TmsDatabase =
        Room.databaseBuilder(context, TmsDatabase::class.java, TmsDatabase.NAME)
            // Field data must never be silently dropped: no destructive migrations.
            .build()

    /** Plain client: token refresh and presigned photo uploads (which must not carry our bearer token). */
    @Provides @Singleton @Named("upload")
    fun uploadClient(): OkHttpClient = OkHttpClient.Builder()
        .connectTimeout(20, TimeUnit.SECONDS)
        .writeTimeout(120, TimeUnit.SECONDS)
        .readTimeout(60, TimeUnit.SECONDS)
        .build()

    @Provides @Singleton
    fun apiClient(session: SessionStore, @Named("upload") plain: OkHttpClient): OkHttpClient = plain.newBuilder()
        .addInterceptor(AuthInterceptor(session))
        .authenticator(TokenAuthenticator(session, plain))
        .build()

    @Provides @Singleton
    fun api(client: OkHttpClient): TmsApi = Retrofit.Builder()
        .baseUrl(BuildConfig.API_BASE_URL)
        .client(client)
        .addConverterFactory(TmsJson.asConverterFactory("application/json".toMediaType()))
        .build()
        .create(TmsApi::class.java)
}
