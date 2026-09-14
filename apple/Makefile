DESTINATION ?= platform=iOS Simulator,name=iPhone 17 Pro
PROJECT := ReproRelay.xcodeproj

.PHONY: generate core-test build test
generate:
	xcodegen generate --spec project.yml

core-test:
	swift test --package-path Packages/RelayCore

build:
	xcodebuild -project $(PROJECT) -scheme ReproRelay -destination '$(DESTINATION)' -derivedDataPath DerivedData CODE_SIGNING_ALLOWED=NO build

test: core-test
	xcodebuild -project $(PROJECT) -scheme ReproRelay -destination '$(DESTINATION)' -derivedDataPath DerivedData -parallel-testing-enabled NO CODE_SIGNING_ALLOWED=NO test
