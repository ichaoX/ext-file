APP_DIR := $(shell realpath app)
WEBEXT_DIR := $(shell realpath src)

channel ?= unlisted

.PHONY: build
build: build_webext

.PHONY: build_app
build_app:
	python "${APP_DIR}/build.py"
	chmod o+w -R "${APP_DIR}/dist/"*

.PHONY: build_lib_ext
build_lib_ext:
	cd "${WEBEXT_DIR}" && \
	echo "/**\n * File System Access Extension\n * @version: $$(grep -oP '(?<="version": ")[\.\d]+' manifest.json)\n */\n" > assets/file-system-access.js && \
	cat lib/enum.js lib/api/fs.js lib/external.js lib/worker.js >> assets/file-system-access.js

.PHONY: build_assets
build_assets: build_lib_ext build_app
	rm -f ${WEBEXT_DIR}/assets/*.zip && \
	cd "${APP_DIR}/dist/" && \
	for dir in */; do \
		zip -r "${WEBEXT_DIR}/assets/helper-app-lite-$${dir%/}.zip" "$$dir"; \
	done

.PHONY: build_webext
build_webext: build_assets
	cd "${WEBEXT_DIR}" && \
	web-ext build -o -i '!assets/*'

.PHONY: build_win_app
build_win_app:
	cd "${APP_DIR}/dist/" && \
	[ -f windows/*.exe ] && \
	rm -f helper-app-full-windows.zip && \
	zip -r helper-app-full-windows.zip "windows"

.PHONY: sign
sign: build_assets
	cd "${WEBEXT_DIR}" && \
	web-ext sign --api-key "$(api-key)" --api-secret "$(api-secret)" --channel "$(channel)" -i '!assets/*'
