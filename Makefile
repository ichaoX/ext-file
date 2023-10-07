APP_DIR := $(shell realpath app)
WEBEXT_DIR := $(shell realpath src)

build: build_webext

build_app:
	python "${APP_DIR}/build.py"

build_assets: build_app
	cd "${APP_DIR}/dist/" && \
	for dir in */; do \
		zip -r "${WEBEXT_DIR}/assets/$${dir%/}.zip" "$$dir"; \
	done

build_webext: build_assets
	cd "${WEBEXT_DIR}" && \
	web-ext build -o -i '!assets/*'
