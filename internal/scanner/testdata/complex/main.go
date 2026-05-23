package main

func simple() int {
	return 1
}

func medium(x int) int {
	if x > 0 {
		return 1
	}
	return 0
}

func complex(x int) int {
	result := 0
	if x > 0 {
		for i := 0; i < x; i++ {
			if i%2 == 0 {
				result += i
			} else {
				result -= i
			}
		}
	} else {
		for i := x; i < 0; i++ {
			if i%2 == 0 {
				result += i
			}
		}
	}
	return result
}

func switchComplex(val string) int {
	switch val {
	case "a":
		return 1
	case "b":
		return 2
	case "c":
		return 3
	default:
		return 0
	}
}

func veryComplex(items []int) int {
	result := 0
	for _, item := range items {
		switch {
		case item > 100:
			if item%2 == 0 {
				result += item
			}
		case item > 50:
			for j := 0; j < item; j++ {
				if j%3 == 0 {
					result += j
				}
			}
		default:
			if item > 0 {
				result += item
			}
		}
	}
	return result
}
