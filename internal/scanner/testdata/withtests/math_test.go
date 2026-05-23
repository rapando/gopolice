package withtests

import "testing"

func TestAdd(t *testing.T) {
	result := Add(2, 3)
	if result != 5 {
		t.Errorf("expected 5, got %d", result)
	}
}

func TestSubtract(t *testing.T) {
	result := Subtract(10, 4)
	if result != 6 {
		t.Errorf("expected 6, got %d", result)
	}
}

func TestDivide(t *testing.T) {
	result, err := Divide(10, 2)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if result != 5 {
		t.Errorf("expected 5, got %d", result)
	}
}

func TestDivideByZero(t *testing.T) {
	_, err := Divide(1, 0)
	if err == nil {
		t.Error("expected error for division by zero")
	}
}

func TestFailing(t *testing.T) {
	result := Add(1, 1)
	if result != 3 {
		t.Errorf("expected 3, got %d", result)
	}
}
