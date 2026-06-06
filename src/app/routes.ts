import { createBrowserRouter } from 'react-router';
import Layout from './components/Layout';
import Dashboard from './pages/Dashboard';
import DocumentCreate from './pages/DocumentCreate';
import LearningWorkspace from './pages/LearningWorkspace';
import LessonsPage from './pages/LessonsPage';
import LoginPage from './pages/LoginPage';
import RegisterPage from './pages/RegisterPage';
import Library from './pages/Library';
import RoadmapPage from './pages/RoadmapPage';

export const router = createBrowserRouter([
  {
    path: '/login',
    Component: LoginPage,
  },
  {
    path: '/register',
    Component: RegisterPage,
  },
  {
    path: '/',
    Component: Layout,
    children: [
      { index: true, Component: Dashboard },
      { path: 'create', Component: DocumentCreate },
      { path: 'library', Component: Library },
      { path: 'lessons', Component: LessonsPage },
      { path: 'roadmap', Component: RoadmapPage },
      { path: 'learn', Component: LearningWorkspace },
      { path: 'learn/:lessonId', Component: LearningWorkspace },
    ],
  },
]);