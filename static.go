package main

import "embed"

//go:embed ui/dist/*
var UIFS embed.FS
