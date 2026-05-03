'use client';

import { ShieldCheck, BarChart3, Settings, Users } from 'lucide-react';
import LoginForm from '@/components/LoginForm';

export default function LoginPage() {
  return (
    <main className="strict-login-page">
      <section className="strict-login-shell">
        <article className="strict-login-left">
          <div className="strict-left-overlay" />
          <div className="strict-left-content">
            <h1>Hawana Airways</h1>
            <h2>
              Hawana Airways Management System <span>(HAMS)</span>
            </h2>
            <p>
              The central digital platform to manage bookings, operations, finance, maintenance, crew and
              more.
            </p>
            <ul className="strict-feature-list">
              <li>
                <ShieldCheck size={16} /> Secure Access
              </li>
              <li>
                <BarChart3 size={16} /> Real-time Analytics
              </li>
              <li>
                <Settings size={16} /> Operational Efficiency
              </li>
              <li>
                <Users size={16} /> Team Collaboration
              </li>
            </ul>
          </div>
        </article>

        <div className="strict-login-right">
          <LoginForm />
        </div>
      </section>
    </main>
  );
}
