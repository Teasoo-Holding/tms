# kotlinx.serialization: keep generated serializers for DTOs.
-keepattributes *Annotation*, InnerClasses
-keepclassmembers class com.teasoo.tms.** { *** Companion; }
-keepclasseswithmembers class com.teasoo.tms.** { kotlinx.serialization.KSerializer serializer(...); }
-keep,includedescriptorclasses class com.teasoo.tms.**$$serializer { *; }
# Retrofit service interfaces are used via reflection.
-keep,allowobfuscation interface com.teasoo.tms.data.remote.TmsApi
-dontwarn org.slf4j.**
# Credential Manager finds its Play services provider by reflection (Sign in with Google).
-if class androidx.credentials.CredentialManager
-keep class androidx.credentials.playservices.** { *; }
