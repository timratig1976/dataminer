<?php

use App\Http\Controllers\Auth\AuthenticatedSessionController;
use App\Http\Controllers\Auth\EmailVerificationNotificationController;
use App\Http\Controllers\Auth\NewPasswordController;
use App\Http\Controllers\Auth\PasswordResetLinkController;
use App\Http\Controllers\Auth\RegisteredUserController;
use App\Http\Controllers\Auth\VerifyEmailController;
use App\Http\Controllers\Auth\MagicLoginController;
use App\Http\Controllers\Auth\InvitationAcceptController;
use App\Http\Controllers\Auth\ResetPasswordViewController;
use Illuminate\Support\Facades\Route;

Route::get('/login', [AuthenticatedSessionController::class, 'create'])
    ->middleware('guest')
    ->name('login');

Route::post('/register', [RegisteredUserController::class, 'store'])
    ->middleware('guest')
    ->name('register');

Route::post('/login', [AuthenticatedSessionController::class, 'store'])
    ->middleware('guest');

// ── Magic Link Authentication ────────────────────────────────────────────────
Route::post('/api/auth/magic-link', [MagicLoginController::class, 'send'])
    ->middleware('throttle:10,1');

Route::get('/magic-login/{token}', [MagicLoginController::class, 'consume'])
    ->name('magic-login.consume');

// ── Password Reset Views & Actions ──────────────────────────────────────────
Route::get('/forgot-password', [ResetPasswordViewController::class, 'showForgot'])
    ->middleware('guest')
    ->name('password.request');

Route::post('/forgot-password', [PasswordResetLinkController::class, 'store'])
    ->middleware('guest')
    ->name('password.email');

Route::get('/reset-password/{token}', [ResetPasswordViewController::class, 'showReset'])
    ->middleware('guest')
    ->name('password.reset');

Route::post('/reset-password', [NewPasswordController::class, 'store'])
    ->middleware('guest')
    ->name('password.store');

// ── Invitations ─────────────────────────────────────────────────────────────
Route::get('/invitations/{token}', [InvitationAcceptController::class, 'show'])
    ->name('invitations.show');

Route::post('/invitations/{token}', [InvitationAcceptController::class, 'accept'])
    ->name('invitations.accept');

Route::get('/verify-email/{id}/{hash}', VerifyEmailController::class)
    ->middleware(['auth', 'signed', 'throttle:6,1'])
    ->name('verification.verify');

Route::post('/email/verification-notification', [EmailVerificationNotificationController::class, 'store'])
    ->middleware(['auth', 'throttle:6,1'])
    ->name('verification.send');

Route::post('/logout', [AuthenticatedSessionController::class, 'destroy'])
    ->middleware('auth')
    ->name('logout');

Route::get('/logout', [AuthenticatedSessionController::class, 'destroy'])
    ->name('logout.get');
