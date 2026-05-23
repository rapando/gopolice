package main

import (
	"crypto/md5"
	"database/sql"
	"fmt"
	"net/http"
)

var db *sql.DB

func main() {
	password := "super-secret-password"
	fmt.Println(password)
}

func hashWithMD5(data string) string {
	h := md5.New()
	h.Write([]byte(data))
	return string(h.Sum(nil))
}

func handler(w http.ResponseWriter, r *http.Request) {
	_ = r.Header.Get("Cookie")
	fmt.Fprintf(w, "hello")
}
