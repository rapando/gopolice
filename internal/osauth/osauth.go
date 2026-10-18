// Package osauth verifies a user against the operating system itself: the
// account password, or the biometric/password prompt (Touch ID). Only macOS
// is supported. It shells out to osascript (JavaScript for Automation), which
// keeps the build free of cgo.
package osauth

import (
	"context"
	"errors"
	"os"
	"os/exec"
	"os/user"
	"runtime"
	"strings"
	"time"
)

// ErrUnsupported is returned on platforms without OS authentication.
var ErrUnsupported = errors.New("OS authentication is only supported on macOS")

// Supported reports whether OS authentication works on this platform.
func Supported() bool { return runtime.GOOS == "darwin" }

// CurrentUser returns the account the service runs as.
func CurrentUser() (string, error) {
	u, err := user.Current()
	if err != nil {
		return "", err
	}
	return u.Username, nil
}

// Opendirectory check. The user name and password arrive in the environment,
// not argv, so they are not visible in the process list.
const passwordScript = `
ObjC.import('OpenDirectory')
function run() {
  const env = $.NSProcessInfo.processInfo.environment
  const user = ObjC.unwrap(env.objectForKey('GP_USER'))
  const pw = ObjC.unwrap(env.objectForKey('GP_PW'))
  const err = Ref()
  const node = $.ODNode.nodeWithSessionTypeError($.ODSession.defaultSession, $.kODNodeTypeAuthentication, err)
  if (!node) return 'error'
  const rec = node.recordWithRecordTypeNameAttributesError($.kODRecordTypeUsers, user, $(), err)
  if (!rec) return 'denied'
  return rec.verifyPasswordError(pw, err) ? 'ok' : 'denied'
}`

// LocalAuthentication deviceOwnerAuthentication: Touch ID, falling back to the
// account password in the system dialog.
const biometricScript = `
ObjC.import('LocalAuthentication'); ObjC.import('Foundation')
function run() {
  const reason = ObjC.unwrap($.NSProcessInfo.processInfo.environment.objectForKey('GP_REASON'))
  const c = $.LAContext.alloc.init
  let done = false, ok = false
  c.evaluatePolicyLocalizedReasonReply(2, reason, (success, error) => { ok = success; done = true })
  const end = Date.now() + 60000
  while (!done && Date.now() < end) $.NSRunLoop.currentRunLoop.runUntilDate($.NSDate.dateWithTimeIntervalSinceNow(0.1))
  return done ? (ok ? 'ok' : 'denied') : 'timeout'
}`

func runScript(ctx context.Context, script string, env ...string) (string, error) {
	if !Supported() {
		return "", ErrUnsupported
	}
	ctx, cancel := context.WithTimeout(ctx, 75*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, "osascript", "-l", "JavaScript", "-e", script)
	cmd.Env = append(os.Environ(), env...)
	out, err := cmd.Output()
	if err != nil {
		return "", err
	}
	return strings.TrimSpace(string(out)), nil
}

// VerifyPassword reports whether password is username's macOS account password.
func VerifyPassword(ctx context.Context, username, password string) (bool, error) {
	if username == "" || password == "" {
		return false, nil
	}
	out, err := runScript(ctx, passwordScript, "GP_USER="+username, "GP_PW="+password)
	if err != nil {
		return false, err
	}
	return out == "ok", nil
}

// Biometric shows the system Touch ID / password prompt on this Mac and
// reports whether the person at the machine approved it.
func Biometric(ctx context.Context, reason string) (bool, error) {
	out, err := runScript(ctx, biometricScript, "GP_REASON="+reason)
	if err != nil {
		return false, err
	}
	return out == "ok", nil
}
