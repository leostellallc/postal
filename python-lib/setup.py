#!/usr/bin/env python3
import setuptools

setuptools.setup(
    name="postal",
    version="3.5",
    author="Matthieu Bucchianeri",
    description="The Postal API",
    long_description="The Postal API enables access to Postal datasets",
    packages=setuptools.find_packages(),
    install_requires=['pandas', 'psutil', 'zstandard'],
    python_requires='>=3.6',
)
