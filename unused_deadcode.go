package main

//nolint:unused
func unusedDeadFunc1() int {
	return 42
}

//nolint:unused
type unusedDeadStruct struct {
	X int
}

//nolint:unused
const unusedDeadConst = "this is never used"

//nolint:unused
var unusedDeadVar = []int{1, 2, 3}
