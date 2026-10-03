import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const target = process.env.SERVER_URL ?? 'http://localhost:8787'

export default defineConfig({
	plugins: [react(), tailwindcss()],
	// Read VITE_* variables from the repo-root .env shared with the server.
	envDir: '..',
	// Its `?url` asset imports must go through Vite's asset pipeline, not the dep optimizer.
	optimizeDeps: { exclude: ['@tldraw/assets'] },
	server: {
		port: Number(process.env.CLIENT_PORT ?? 5173),
		proxy: {
			'/api': target,
			'/sync': { target, ws: true },
			'/agent': { target, ws: true },
		},
	},
})
