package api

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestLocalOnlyMiddleware(t *testing.T) {
	ok := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	})
	h := localOnlyMiddleware(ok)

	tests := []struct {
		name    string
		method  string
		host    string
		headers map[string]string
		want    int
	}{
		{"get localhost", http.MethodGet, "localhost:9393", nil, http.StatusOK},
		{"get ipv4 loopback", http.MethodGet, "127.0.0.1:9393", nil, http.StatusOK},
		{"get ipv6 loopback", http.MethodGet, "[::1]:9393", nil, http.StatusOK},
		{"rebound host", http.MethodGet, "evil.example.com:9393", nil, http.StatusForbidden},
		{"lan ip host", http.MethodGet, "192.168.1.5:9393", nil, http.StatusForbidden},
		{"post same origin", http.MethodPost, "localhost:9393", map[string]string{"Origin": "http://localhost:9393"}, http.StatusOK},
		{"post no origin", http.MethodPost, "localhost:9393", nil, http.StatusOK},
		{"post cross origin", http.MethodPost, "localhost:9393", map[string]string{"Origin": "https://evil.example.com"}, http.StatusForbidden},
		{"post other local port", http.MethodPost, "localhost:9393", map[string]string{"Origin": "http://localhost:3000"}, http.StatusForbidden},
		{"put cross site fetch", http.MethodPut, "localhost:9393", map[string]string{"Sec-Fetch-Site": "cross-site"}, http.StatusForbidden},
		{"get cross origin allowed", http.MethodGet, "localhost:9393", map[string]string{"Origin": "https://evil.example.com"}, http.StatusOK},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			req := httptest.NewRequest(tt.method, "/api/scan", nil)
			req.Host = tt.host
			for k, v := range tt.headers {
				req.Header.Set(k, v)
			}
			rec := httptest.NewRecorder()
			h.ServeHTTP(rec, req)
			if rec.Code != tt.want {
				t.Errorf("got status %d, want %d", rec.Code, tt.want)
			}
			if got := rec.Header().Get("Access-Control-Allow-Origin"); got != "" {
				t.Errorf("unexpected CORS header %q", got)
			}
		})
	}
}
