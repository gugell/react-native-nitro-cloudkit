require "json"

package = JSON.parse(File.read(File.join(__dir__, "package.json")))

Pod::Spec.new do |s|
  s.name         = "NitroCloudKit"
  s.version      = package["version"]
  s.summary      = package["description"]
  s.homepage     = "https://github.com/gugell/react-native-nitro-cloudkit"
  s.license      = package["license"]
  s.authors      = package["author"]

  # CKSyncEngine needs iOS 17 / macOS 14; older systems load the module and report it unsupported.
  s.platforms    = { :ios => min_ios_version_supported, :osx => "14.0" }
  s.source       = { :git => "https://github.com/gugell/react-native-nitro-cloudkit.git", :tag => "v#{s.version}" }

  s.source_files = [
    "ios/**/*.{swift}",
  ]
  s.frameworks   = "CloudKit", "CryptoKit"

  load 'nitrogen/generated/ios/NitroCloudKit+autolinking.rb'
  add_nitrogen_files(s)

  s.dependency 'React-jsi'
  s.dependency 'React-callinvoker'
  install_modules_dependencies(s)
end
