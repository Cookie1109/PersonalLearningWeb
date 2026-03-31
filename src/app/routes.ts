import { createBrowserRouter } from 'react-router';
import Layout from './components/Layout';
import Dashboard from './pages/Dashboard';
import RoadmapGenerator from './pages/RoadmapGenerator';
import LearningWorkspace from './pages/LearningWorkspace';
import QuizPage from './pages/QuizPage';
import LessonsPage from './pages/LessonsPage';
import LoginPage from './pages/LoginPage';
import RegisterPage from './pages/RegisterPage';

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
      { path: 'roadmap', Component: RoadmapGenerator },
      { path: 'lessons', Component: LessonsPage },
      { path: 'learn', Component: LearningWorkspace },
      { path: 'learn/:lessonId', Component: LearningWorkspace },
      { path: 'quiz', Component: QuizPage },
    ],
  },
]);