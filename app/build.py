#!/usr/bin/env python

import logging
import os
import shutil
import sys

rootDir = os.path.dirname(os.path.abspath(__file__))
srcDir = os.path.join(rootDir, 'src')
commonAssetDir = os.path.join(srcDir, 'common')

distDir = os.path.join(rootDir, 'dist')
windowsDir = os.path.join(distDir, 'windows')
linuxDir = os.path.join(distDir, 'linux')
macDir = os.path.join(distDir, 'macos')

appFileName = 'fsa-host.py'
manifestFileName = 'manifest.template.json'


def copytree(src, dst):
    for item in os.listdir(src):
        s = os.path.join(src, item)
        d = os.path.join(dst, item)
        if os.path.isdir(s):
            shutil.copytree(s, d)
        else:
            shutil.copy2(s, d)


platformDir = windowsDir
platformAssetDir = os.path.join(srcDir, 'windows')

if os.path.isdir(platformDir):
    shutil.rmtree(platformDir)
os.makedirs(platformDir)

copytree(commonAssetDir, platformDir)
copytree(platformAssetDir, platformDir)

if sys.platform == 'win32':
    try:
        import PyInstaller.__main__
        PyInstaller.__main__.run([
            # os.path.join(commonAssetDir, appFileName),
            os.path.join(srcDir, appFileName + '.spec'),
            '--distpath', platformDir,
            '--workpath', os.path.join(rootDir, 'build'),
            # '--specpath', srcDir,
            # '--onedir',
            # '--contents-directory', 'lib',
        ])
    except Exception as e:
        logging.exception('pyinstaller failed to execute')

_ = os.path.join(platformDir, os.path.splitext(appFileName)[0])
if os.path.isdir(_):
    for name in os.listdir(_):
        shutil.move(os.path.join(_, name), platformDir)
    os.rmdir(_)

platformDir = linuxDir
platformAssetDir = os.path.join(srcDir, 'linux')

if os.path.isdir(platformDir):
    shutil.rmtree(platformDir)
os.makedirs(platformDir)

copytree(commonAssetDir, platformDir)
copytree(platformAssetDir, platformDir)


platformDir = macDir
platformAssetDir = os.path.join(srcDir, 'macos')

if os.path.isdir(platformDir):
    shutil.rmtree(platformDir)
os.makedirs(platformDir)

copytree(commonAssetDir, platformDir)
copytree(platformAssetDir, platformDir)
