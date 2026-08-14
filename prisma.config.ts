// prisma.config.ts
import { defineConfig } from 'prisma/config'
import 'dotenv/config' // Load environment variables

declare const process: {
    env: {
        DATABASE_URL?: string
    }
}

export default defineConfig({
    datasource: {
        url: process.env.DATABASE_URL!,
    },
    // Optional: If you want to specify a different schema location
    // schema: './prisma/schema.prisma',
})