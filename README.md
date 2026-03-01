# 🛒 Smart Shopping List

A modern shopping list management application built with Next.js 15, TypeScript, Prisma, and NextAuth.

## ✨ Features

- 🔐 **Secure Authentication** - Authentication system powered by NextAuth v5
- ⚡ **Instant Response** - Optimistic UI updates using React's `useOptimistic`
- 🤝 **List Sharing** - Share shopping lists with other users
- ✅ **Item Management** - Add, mark as complete, and delete items
- 🎨 **Modern UI** - Responsive design with Tailwind CSS v4
- 💾 **Persistent Data** - Data management with PostgreSQL and Prisma ORM

## 🛠️ Tech Stack

- **Framework**: [Next.js 15](https://nextjs.org/) (App Router)
- **Language**: [TypeScript](https://www.typescriptlang.org/)
- **Database**: [PostgreSQL](https://www.postgresql.org/)
- **ORM**: [Prisma](https://www.prisma.io/)
- **Authentication**: [NextAuth v5](https://next-auth.js.org/)
- **Styling**: [Tailwind CSS v4](https://tailwindcss.com/)
- **Validation**: [Zod](https://zod.dev/)

## 📋 Prerequisites

- Node.js 20.x or higher
- PostgreSQL database
- npm or yarn

## 🚀 Getting Started

1. **Clone the repository**

```bash
git clone https://github.com/yourusername/smart-lists.git
cd smart-lists
```

2. **Install dependencies**

```bash
npm install
```

3. **Set up environment variables**

Create a `.env` file in the project root and configure the following variables:

```env
# Database connection
DATABASE_URL="postgresql://user:password@localhost:5432/shopping_list"

# NextAuth configuration
AUTH_SECRET="your-secret-key-here"  # Generate with: openssl rand -base64 32
AUTH_URL="http://localhost:3000"

# OAuth provider configuration (if using)
# AUTH_GOOGLE_ID="your-google-client-id"
# AUTH_GOOGLE_SECRET="your-google-client-secret"
```

4. **Set up the database**

```bash
# Run Prisma migrations
npx prisma migrate dev

# View database with Prisma Studio (optional)
npx prisma studio
```

5. **Start the development server**

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser to see the application.

## 📁 Project Structure

```
smart-lists/
├── src/
│   ├── app/
│   │   ├── actions.ts          # Server Actions
│   │   ├── page.tsx            # Main page
│   │   ├── layout.tsx          # Root layout
│   │   ├── api/
│   │   │   └── auth/           # NextAuth API routes
│   │   └── components/
│   │       └── SmartList.tsx    # List component
│   ├── lib/
│   │   ├── db.ts               # Prisma client
│   │   └── validations.ts      # Zod schemas
│   └── auth.ts                 # NextAuth configuration
├── prisma/
│   └── schema.prisma           # Database schema
└── package.json
```

## 🎯 Usage

1. **Create an account/Login**
   - Enter your email and password on the homepage
   - Or log in with your configured OAuth provider

2. **Create a shopping list**
   - After logging in, create a new list
   - Enter the list name and save

3. **Add items**
   - Enter an item name within the list
   - Press Enter or click the add button

4. **Manage items**
   - Click the checkbox to toggle completion status
   - Click the trash icon to delete items

5. **Share lists**
   - Invite other users via the share button
   - Shared lists can be edited in real-time by all members

## 🔧 Available Scripts

```bash
# Start development server
npm run dev

# Build for production
npm run build

# Start production server
npm start

# Lint code with ESLint
npm run lint

# Run Prisma migrations
npx prisma migrate dev

# Launch Prisma Studio
npx prisma studio
```

## 🚢 Deployment

### Deploy to Vercel

The easiest way is to use the [Vercel Platform](https://vercel.com/new).

1. Connect your GitHub repository to Vercel
2. Configure environment variables
3. Click deploy

For more details, see the [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying).

You'll need to host both the database (PostgreSQL) and the application.
