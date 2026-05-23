package history

import (
	"testing"
	"time"
)

func TestTimestampRoundTrip(t *testing.T) {
	now := time.Now().UTC().Truncate(time.Second)
	encoded := encodeTimestamp(now)
	decoded, err := decodeTimestamp(encoded)
	if err != nil {
		t.Fatalf("decodeTimestamp(%q): %v", encoded, err)
	}
	if !decoded.Equal(now) {
		t.Errorf("round-trip: got %v, want %v", decoded, now)
	}
}

func TestTimestampZero(t *testing.T) {
	var zero time.Time
	encoded := encodeTimestamp(zero)
	if _, err := decodeTimestamp(encoded); err != nil {
		t.Fatalf("zero time round-trip: %v", err)
	}
}
