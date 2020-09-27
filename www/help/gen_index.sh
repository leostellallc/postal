#!/bin/bash
pandoc --standalone --toc -f markdown -t html -o index.html INDEX.md
