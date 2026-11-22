package com.margelo.nitro.cloudkit

import androidx.annotation.Keep
import com.facebook.proguard.annotations.DoNotStrip
import com.margelo.nitro.core.Promise

/**
 * Android has no CloudKit: the module loads, reports itself unsupported, and `openStore`
 * rejects with `unsupported_platform` (the same coded message format iOS uses).
 */
@DoNotStrip
@Keep
class HybridCloudKit : HybridCloudKitSpec() {
  override val isSupported: Boolean
    get() = false

  override fun openStore(options: CloudKitStoreOptions): Promise<HybridCloudKitStoreSpec> =
    Promise.rejected(
      Error("[nitro-cloudkit:unsupported_platform] CloudKit is only available on Apple platforms"),
    )
}
