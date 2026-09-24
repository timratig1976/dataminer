import '../css/app.css';
import { createInertiaApp } from '@inertiajs/react';
import { resolvePageComponent } from 'laravel-vite-plugin/inertia-helpers';
import { createRoot } from 'react-dom/client';
import { router } from '@inertiajs/react';

// Intercept non-Inertia responses to prevent default intrusive 404 iframe overlay
router.on('invalid', (event) => {
    event.preventDefault();
});

const appName = import.meta.env.VITE_APP_NAME || 'DataMiner';

createInertiaApp({
    title: (title) => title ? `${title} — ${appName}` : `${appName} — High-Performance Lead Engine`,
    resolve: (name) =>
        resolvePageComponent(
            `./Pages/${name}.tsx`,
            import.meta.glob('./Pages/**/*.tsx')
        ),
    setup({ el, App, props }) {
        const root = createRoot(el);
        root.render(<App {...props} />);
    },
    progress: {
        color: '#4B5563',
    },
});
