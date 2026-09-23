<?php

namespace App\Http\Controllers\Auth;

use App\Http\Controllers\Controller;
use Illuminate\Http\Request;
use Inertia\Inertia;
use Inertia\Response;

class ResetPasswordViewController extends Controller
{
    /**
     * Show Forgot Password Request form.
     * GET /forgot-password
     */
    public function showForgot(): Response
    {
        return Inertia::render('Auth/ForgotPassword');
    }

    /**
     * Show Set New Password form.
     * GET /reset-password/{token}
     */
    public function showReset(Request $request, string $token): Response
    {
        return Inertia::render('Auth/ResetPassword', [
            'token' => $token,
            'email' => $request->query('email', ''),
        ]);
    }
}
