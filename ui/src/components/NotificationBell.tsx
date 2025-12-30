import React, { useState, useRef, useEffect } from 'react';
import { useNotifications } from '../hooks/useNotifications';
import { Notification } from '../api/notifications';
import { useNavigate } from 'react-router-dom';
import './NotificationBell.css';

// Inline SVG icons
const BellIcon = ({ size = 20 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
    <path d="M13.73 21a2 2 0 0 1-3.46 0" />
  </svg>
);

const CheckIcon = ({ size = 16 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="20 6 9 17 4 12" />
  </svg>
);

const Trash2Icon = ({ size = 16 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="3 6 5 6 21 6" />
    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    <line x1="10" y1="11" x2="10" y2="17" />
    <line x1="14" y1="11" x2="14" y2="17" />
  </svg>
);

const ExternalLinkIcon = ({ size = 14 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
    <polyline points="15 3 21 3 21 9" />
    <line x1="10" y1="14" x2="21" y2="3" />
  </svg>
);

const getTimeAgo = (dateStr: string): string => {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return '방금 전';
  if (diffMins < 60) return `${diffMins}분 전`;
  if (diffHours < 24) return `${diffHours}시간 전`;
  if (diffDays < 7) return `${diffDays}일 전`;
  return date.toLocaleDateString('ko-KR');
};

const getNotificationIcon = (type: string): string => {
  switch (type) {
    case 'share.received':
      return '📁';
    case 'share.permission_changed':
      return '🔐';
    case 'share.removed':
      return '❌';
    case 'shared_folder.invited':
      return '📂';
    case 'shared_folder.removed':
      return '🚫';
    case 'shared_file.modified':
      return '✏️';
    case 'share_link.accessed':
      return '🔗';
    case 'upload_link.received':
      return '📤';
    default:
      return '🔔';
  }
};

export const NotificationBell: React.FC = () => {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  const {
    notifications,
    unreadCount,
    isLoading,
    handleMarkAsRead,
    handleMarkAllAsRead,
    handleDelete,
    handleDeleteAllRead,
  } = useNotifications();

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleNotificationClick = (notification: Notification) => {
    if (!notification.isRead) {
      handleMarkAsRead(notification.id);
    }
    if (notification.link) {
      setIsOpen(false);
      navigate(notification.link);
    }
  };

  return (
    <div className="notification-bell" ref={dropdownRef}>
      <button
        className="notification-bell__button"
        onClick={() => setIsOpen(!isOpen)}
        aria-label="알림"
      >
        <BellIcon size={20} />
        {unreadCount > 0 && (
          <span className="notification-bell__badge">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {isOpen && (
        <div className="notification-dropdown">
          <div className="notification-dropdown__header">
            <h3>알림</h3>
            {notifications.length > 0 && (
              <div className="notification-dropdown__actions">
                <button
                  onClick={handleMarkAllAsRead}
                  title="모두 읽음 처리"
                  disabled={unreadCount === 0}
                >
                  <CheckIcon size={16} />
                </button>
                <button
                  onClick={handleDeleteAllRead}
                  title="읽은 알림 삭제"
                >
                  <Trash2Icon size={16} />
                </button>
              </div>
            )}
          </div>

          <div className="notification-dropdown__content">
            {isLoading && notifications.length === 0 ? (
              <div className="notification-dropdown__empty">
                로딩 중...
              </div>
            ) : notifications.length === 0 ? (
              <div className="notification-dropdown__empty">
                알림이 없습니다
              </div>
            ) : (
              <ul className="notification-list">
                {notifications.slice(0, 5).map((notification) => (
                  <li
                    key={notification.id}
                    className={`notification-item ${notification.isRead ? 'notification-item--read' : ''}`}
                  >
                    <div
                      className="notification-item__content"
                      onClick={() => handleNotificationClick(notification)}
                    >
                      <span className="notification-item__icon">
                        {getNotificationIcon(notification.type)}
                      </span>
                      <div className="notification-item__text">
                        <div className="notification-item__title">
                          {notification.title}
                        </div>
                        {notification.message && (
                          <div className="notification-item__message">
                            {notification.message}
                          </div>
                        )}
                        <div className="notification-item__meta">
                          <span className="notification-item__time">
                            {getTimeAgo(notification.createdAt)}
                          </span>
                          {notification.actorName && (
                            <span className="notification-item__actor">
                              {notification.actorName}
                            </span>
                          )}
                        </div>
                      </div>
                      {notification.link && (
                        <span className="notification-item__link-icon">
                          <ExternalLinkIcon size={14} />
                        </span>
                      )}
                    </div>
                    <button
                      className="notification-item__delete"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDelete(notification.id);
                      }}
                      title="삭제"
                    >
                      <Trash2Icon size={14} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="notification-dropdown__footer">
            <button
              className="notification-dropdown__view-all"
              onClick={() => {
                setIsOpen(false);
                navigate('/notifications');
              }}
            >
              전체보기
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
