#include <jni.h>
#include "NitroCloudKitOnLoad.hpp"

JNIEXPORT jint JNICALL JNI_OnLoad(JavaVM* vm, void*) {
  return margelo::nitro::cloudkit::initialize(vm);
}
