Pod::Spec.new do |s|
  s.name = 'BlackfishLiveActivity'
  s.version = '0.0.1'
  s.summary = 'Blackfish: running agents as a Live Activity and in the agents widget'
  s.description = s.summary
  s.license = { :type => 'MIT' }
  s.author = 'Blackfish'
  s.homepage = 'https://github.com/saltyfireball/orca'
  s.source = { :git => 'https://github.com/saltyfireball/orca.git' }
  s.platforms = { :ios => '16.4' }
  s.swift_version = '5.9'
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.frameworks = 'ActivityKit', 'WidgetKit'
  s.source_files = '**/*.swift'
end
