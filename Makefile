APP_DIR := $(shell realpath app)
WEBEXT_DIR := $(shell realpath src)

.PHONY: build
build: build_webext

.PHONY: build_app
build_app:
	python "${APP_DIR}/build.py"
	chmod o+w -R "${APP_DIR}/dist/"*

.PHONY: build_assets
build_assets: build_app
	cd "${APP_DIR}/dist/" && \
	for dir in */; do \
		zip -r "${WEBEXT_DIR}/assets/$${dir%/}.zip" "$$dir"; \
	done

.PHONY: build_webext
build_webext: build_assets
	cd "${WEBEXT_DIR}" && \
	web-ext build -o -i '!assets/*'

.PHONY: build_win_app
build_win_app:
	cd "${APP_DIR}/dist/" && \
	[ -f windows/*.exe ] && \
	zip -r "windows-full.zip" "windows"
