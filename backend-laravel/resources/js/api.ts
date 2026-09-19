/**
 * Helper for authenticated API calls from Inertia/React pages.
 * Ensures CSRF-Token (X-XSRF-TOKEN) and Accept: application/json are always present.
 */
function getXsrfToken(): string | null {
    if (typeof document === 'undefined') return null;
    const match = document.cookie.match(new RegExp('(^|;\\s*)XSRF-TOKEN=([^;]+)'));
    return match ? decodeURIComponent(match[2]) : null;
}

export async function apiFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const headers = new Headers(init?.headers || {});

    if (!headers.has('Accept')) {
        headers.set('Accept', 'application/json');
    }

    const xsrf = getXsrfToken();
    if (xsrf && !headers.has('X-XSRF-TOKEN')) {
        headers.set('X-XSRF-TOKEN', xsrf);
    }

    return fetch(input, {
        ...init,
        headers,
        credentials: 'same-origin',
    });
}
