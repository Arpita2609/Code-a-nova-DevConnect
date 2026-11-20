import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { PrismaClient } from '@prisma/client';
import { z } from 'zod';

const app = express();
const prisma = new PrismaClient();
const PORT = Number(process.env.PORT || 5000);
const SECRET = process.env.JWT_SECRET || 'dev-only-change-me';
app.use(cors({ origin: process.env.CLIENT_URL || 'http://localhost:5173' }));
app.use(express.json());

type AuthRequest = express.Request & { userId?: string };
function auth(req: AuthRequest, res: express.Response, next: express.NextFunction) {
  const token = req.headers.authorization?.replace(/^Bearer\s+/i, '');
  if (!token) return res.status(401).json({ message: 'Please log in first.' });
  try {
    const payload = jwt.verify(token, SECRET) as { userId: string };
    req.userId = payload.userId;
    next();
  } catch { return res.status(401).json({ message: 'Session expired. Please log in again.' }); }
}
const safeUser = (u: any) => {
  const { password, ...rest } = u;
  return { ...rest, skills: rest.skills ? rest.skills.split(',').map((s: string) => s.trim()).filter(Boolean) : [] };
};
const notify = (userId: string, message: string) => prisma.notification.create({ data: { userId, message } });

app.get('/api/health', (_req, res) => res.json({ status: 'ok', service: 'DevConnect API' }));

app.post('/api/auth/register', async (req, res) => {
  try {
    const data = z.object({ name: z.string().min(2), email: z.string().email(), password: z.string().min(6) }).parse(req.body);
    const email = data.email.toLowerCase();
    if (await prisma.user.findUnique({ where: { email } })) return res.status(409).json({ message: 'Email already registered.' });
    const user = await prisma.user.create({ data: { name: data.name, email, password: await bcrypt.hash(data.password, 10) } });
    const token = jwt.sign({ userId: user.id }, SECRET, { expiresIn: '7d' });
    res.status(201).json({ token, user: safeUser(user) });
  } catch (e: any) { res.status(400).json({ message: e.issues?.[0]?.message || 'Could not register.' }); }
});
app.post('/api/auth/login', async (req, res) => {
  const data = z.object({ email: z.string().email(), password: z.string().min(1) }).safeParse(req.body);
  if (!data.success) return res.status(400).json({ message: 'Enter a valid email and password.' });
  const user = await prisma.user.findUnique({ where: { email: data.data.email.toLowerCase() } });
  if (!user || !(await bcrypt.compare(data.data.password, user.password))) return res.status(401).json({ message: 'Incorrect email or password.' });
  const token = jwt.sign({ userId: user.id }, SECRET, { expiresIn: '7d' });
  res.json({ token, user: safeUser(user) });
});
app.get('/api/auth/me', auth, async (req: AuthRequest, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.userId! } });
  if (!user) return res.status(404).json({ message: 'User not found.' });
  res.json(safeUser(user));
});

app.get('/api/dashboard', auth, async (req: AuthRequest, res) => {
  const id = req.userId!;
  const [projects, posts, connections, pending, notifications] = await Promise.all([
    prisma.project.count({ where: { authorId: id } }), prisma.blogPost.count({ where: { authorId: id } }),
    prisma.connection.count({ where: { OR: [{ senderId: id }, { receiverId: id }], status: 'ACCEPTED' } }),
    prisma.connection.count({ where: { receiverId: id, status: 'PENDING' } }),
    prisma.notification.findMany({ where: { userId: id }, orderBy: { createdAt: 'desc' }, take: 5 })
  ]);
  res.json({ projects, posts, connections, pending, notifications });
});
app.put('/api/profile', auth, async (req: AuthRequest, res) => {
  const data = z.object({ name: z.string().min(2), headline: z.string().max(100).optional(), bio: z.string().max(1000).optional(), location: z.string().max(100).optional(), skills: z.array(z.string()).optional(), github: z.string().max(300).optional(), linkedin: z.string().max(300).optional() }).safeParse(req.body);
  if (!data.success) return res.status(400).json({ message: 'Please check your profile details.' });
  const d = data.data;
  const user = await prisma.user.update({ where: { id: req.userId! }, data: { ...d, skills: d.skills?.join(',') } });
  res.json(safeUser(user));
});
app.get('/api/users', auth, async (req: AuthRequest, res) => {
  const q = String(req.query.q || '').trim();
  const users = await prisma.user.findMany({ where: { id: { not: req.userId! }, ...(q ? { OR: [{ name: { contains: q } }, { headline: { contains: q } }, { skills: { contains: q } }] } : {}) }, select: { id: true, name: true, headline: true, bio: true, location: true, skills: true, github: true, linkedin: true }, take: 50, orderBy: { createdAt: 'desc' } });
  res.json(users.map(safeUser));
});
app.get('/api/users/:id', auth, async (req, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.params.id }, include: { projects: { orderBy: { createdAt: 'desc' } }, posts: { orderBy: { createdAt: 'desc' } }, endorsements: true } });
  if (!user) return res.status(404).json({ message: 'Developer not found.' });
  res.json({ ...safeUser(user), projects: user.projects, posts: user.posts, endorsements: user.endorsements });
});

app.get('/api/projects', auth, async (_req, res) => res.json(await prisma.project.findMany({ include: { author: { select: { id: true, name: true } } }, orderBy: { createdAt: 'desc' } })));
app.post('/api/projects', auth, async (req: AuthRequest, res) => {
  const d = z.object({ title: z.string().min(2), description: z.string().min(5), techStack: z.string().optional(), link: z.string().optional() }).safeParse(req.body);
  if (!d.success) return res.status(400).json({ message: 'Add a title and a short description.' });
  res.status(201).json(await prisma.project.create({ data: { ...d.data, authorId: req.userId! }, include: { author: { select: { id: true, name: true } } } }));
});
app.delete('/api/projects/:id', auth, async (req: AuthRequest, res) => {
  const p = await prisma.project.findUnique({ where: { id: req.params.id } });
  if (!p) return res.status(404).json({ message: 'Project not found.' });
  if (p.authorId !== req.userId) return res.status(403).json({ message: 'You can delete only your own projects.' });
  await prisma.project.delete({ where: { id: p.id } }); res.json({ message: 'Project deleted.' });
});

app.get('/api/posts', auth, async (_req, res) => res.json(await prisma.blogPost.findMany({ include: { author: { select: { id: true, name: true } } }, orderBy: { createdAt: 'desc' } })));
app.post('/api/posts', auth, async (req: AuthRequest, res) => {
  const d = z.object({ title: z.string().min(3), content: z.string().min(10) }).safeParse(req.body);
  if (!d.success) return res.status(400).json({ message: 'Add a title and at least a few lines.' });
  res.status(201).json(await prisma.blogPost.create({ data: { ...d.data, authorId: req.userId! }, include: { author: { select: { id: true, name: true } } } }));
});
app.delete('/api/posts/:id', auth, async (req: AuthRequest, res) => {
  const p = await prisma.blogPost.findUnique({ where: { id: req.params.id } });
  if (!p) return res.status(404).json({ message: 'Post not found.' });
  if (p.authorId !== req.userId) return res.status(403).json({ message: 'You can delete only your own posts.' });
  await prisma.blogPost.delete({ where: { id: p.id } }); res.json({ message: 'Post deleted.' });
});

app.get('/api/connections', auth, async (req: AuthRequest, res) => {
  const id = req.userId!;
  const rows = await prisma.connection.findMany({ where: { OR: [{ senderId: id }, { receiverId: id }] }, include: { sender: { select: { id: true, name: true, headline: true } }, receiver: { select: { id: true, name: true, headline: true } } }, orderBy: { createdAt: 'desc' } });
  res.json(rows.map(r => ({ ...r, person: r.senderId === id ? r.receiver : r.sender, direction: r.senderId === id ? 'sent' : 'received' })));
});
app.post('/api/connections/:userId', auth, async (req: AuthRequest, res) => {
  const senderId = req.userId!, receiverId = req.params.userId;
  if (senderId === receiverId) return res.status(400).json({ message: 'You cannot connect with yourself.' });
  if (!await prisma.user.findUnique({ where: { id: receiverId } })) return res.status(404).json({ message: 'Developer not found.' });
  const existing = await prisma.connection.findFirst({ where: { OR: [{ senderId, receiverId }, { senderId: receiverId, receiverId: senderId }] } });
  if (existing) return res.status(409).json({ message: 'A connection request already exists.' });
  const c = await prisma.connection.create({ data: { senderId, receiverId } });
  await notify(receiverId, 'You received a new connection request.'); res.status(201).json(c);
});
app.patch('/api/connections/:id', auth, async (req: AuthRequest, res) => {
  const action = z.object({ action: z.enum(['accept', 'reject', 'remove']) }).safeParse(req.body);
  if (!action.success) return res.status(400).json({ message: 'Invalid action.' });
  const c = await prisma.connection.findUnique({ where: { id: req.params.id } });
  if (!c || (c.senderId !== req.userId && c.receiverId !== req.userId)) return res.status(404).json({ message: 'Connection request not found.' });
  if (action.data.action === 'accept') {
    if (c.receiverId !== req.userId || c.status !== 'PENDING') return res.status(403).json({ message: 'This request cannot be accepted.' });
    const updated = await prisma.connection.update({ where: { id: c.id }, data: { status: 'ACCEPTED' } });
    await notify(c.senderId, 'Your connection request was accepted.'); return res.json(updated);
  }
  if (action.data.action === 'reject') {
    if (c.receiverId !== req.userId) return res.status(403).json({ message: 'Only the recipient can reject this request.' });
    await prisma.connection.delete({ where: { id: c.id } }); return res.json({ message: 'Request rejected.' });
  }
  await prisma.connection.delete({ where: { id: c.id } }); res.json({ message: 'Connection removed.' });
});
app.post('/api/users/:id/endorse', auth, async (req: AuthRequest, res) => {
  const skill = z.string().min(1).max(60).parse(req.body.skill || '');
  if (req.params.id === req.userId) return res.status(400).json({ message: 'You cannot endorse yourself.' });
  try {
    const endorsement = await prisma.endorsement.create({ data: { userId: req.params.id, endorserId: req.userId!, skill } });
    await notify(req.params.id, `Someone endorsed your ${skill} skill.`); res.status(201).json(endorsement);
  } catch { res.status(409).json({ message: 'You have already endorsed this skill.' }); }
});
app.get('/api/notifications', auth, async (req: AuthRequest, res) => res.json(await prisma.notification.findMany({ where: { userId: req.userId! }, orderBy: { createdAt: 'desc' } })));
app.patch('/api/notifications/read', auth, async (req: AuthRequest, res) => {
  await prisma.notification.updateMany({ where: { userId: req.userId!, read: false }, data: { read: true } }); res.json({ message: 'Notifications marked as read.' });
});

app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err); res.status(500).json({ message: 'Something went wrong on the server.' });
});
app.listen(PORT, () => console.log(`DevConnect API running at http://localhost:${PORT}`));
