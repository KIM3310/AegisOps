
import { useState, useCallback, useEffect } from 'react';

/**
 * ==============================================================================
 * AUTHENTICATION HOOK (OAuth 2.0 Implicit Flow Wrapper)
 * ==============================================================================
 * Google Identity Services(GIS)의 "Token Model"을 사용하여 클라이언트 사이드에서
 * 직접 Access Token을 발급받습니다.
 * 
 * [Working Principle]
 * 1. `google.accounts.oauth2.initTokenClient`로 클라이언트를 초기화합니다.
 * 2. `requestAccessToken()`을 호출하면 팝업이 뜨고 사용자 동의를 받습니다.
 * 3. 성공 시 callback으로 `access_token`이 전달됩니다.
 * 4. 이 토큰을 Authorization 헤더에 담아 Google API(Gmail, Drive 등)를 호출합니다.
 * 
 * [Why Session Storage?]
 * Access Token은 수명이 짧지만(약 1시간), 사용자가 페이지를 새로고침할 때마다
 * 다시 로그인하게 하면 UX가 저해됩니다. 보안상 민감하지만 SPA 데모 특성상
 * 편의를 위해 Session Storage에 임시 저장하여 상태를 유지합니다.
 */

const CLIENT_ID = ''; // [Config] GCP Console에서 발급받은 Web Client ID 입력

// 필요한 권한 목록
const SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',      // 알림 메일 읽기
  'https://www.googleapis.com/auth/drive.readonly',      // 로그/스크린샷 파일 읽기
  'https://www.googleapis.com/auth/drive.file',          // 생성된 파일 관리
  'https://www.googleapis.com/auth/spreadsheets',        // 데이터셋 내보내기
  'https://www.googleapis.com/auth/documents',           // 포스트모템 문서 생성
  'https://www.googleapis.com/auth/presentations',       // 발표 자료 생성
  'https://www.googleapis.com/auth/calendar.events',     // 회의 일정 생성
].join(' ');

interface GoogleUser {
  email: string;
  name: string;
  picture?: string;
}

export function useGoogleAuth() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [user, setUser] = useState<GoogleUser | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);

  // [Effect] 앱 로드 시 세션 스토리지 체크 (새로고침 대응)
  useEffect(() => {
    const token = sessionStorage.getItem('google_access_token');
    const u = sessionStorage.getItem('google_user');
    
    if (token && u) {
      setAccessToken(token);
      setUser(JSON.parse(u));
      setIsAuthenticated(true);
    }
    setIsLoading(false);
  }, []);

  const signIn = useCallback(async () => {
    setIsLoading(true);

    // [Check] GIS 라이브러리가 로드되었고, Client ID가 설정되어 있는지 확인
    if (CLIENT_ID && (window as any).google?.accounts?.oauth2) {
      
      const client = (window as any).google.accounts.oauth2.initTokenClient({
        client_id: CLIENT_ID,
        scope: SCOPES,
        callback: async (response: any) => {
          if (response.access_token) {
            const token = response.access_token;
            setAccessToken(token);
            sessionStorage.setItem('google_access_token', token);

            // 토큰만으로는 사용자 이름/사진을 알 수 없으므로 UserInfo API 호출
            try {
              const userRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
                headers: { Authorization: `Bearer ${token}` },
              });
              const userData = await userRes.json();
              const u: GoogleUser = {
                email: userData.email,
                name: userData.name,
                picture: userData.picture,
              };
              setUser(u);
              setIsAuthenticated(true);
              sessionStorage.setItem('google_user', JSON.stringify(u));
            } catch {
              console.warn('Failed to fetch user profile, but auth is valid');
              setIsAuthenticated(true);
            }
          }
          setIsLoading(false);
        },
      });
      
      // 팝업 트리거
      client.requestAccessToken();

    } else {
      // [Demo Mode] Client ID가 없을 때 (심사 위원 테스트용)
      console.info('Running in Demo Mode (No Client ID or GIS not loaded)');
      
      // 가짜 딜레이로 실제 로그인 느낌 구현
      await new Promise(resolve => setTimeout(resolve, 800));

      const demoUser: GoogleUser = {
        email: 'demo@aegisops.dev',
        name: 'Demo SRE',
      };
      
      setUser(demoUser);
      setAccessToken('demo_token'); 
      setIsAuthenticated(true);
      
      sessionStorage.setItem('google_user', JSON.stringify(demoUser));
      sessionStorage.setItem('google_access_token', 'demo_token');
      setIsLoading(false);
    }
  }, []);

  const signOut = useCallback(() => {
    // 실제 토큰이라면 권한 취소(Revoke) 호출이 보안상 권장됨
    if (accessToken && accessToken !== 'demo_token' && (window as any).google?.accounts?.oauth2) {
      (window as any).google.accounts.oauth2.revoke(accessToken);
    }
    
    setAccessToken(null);
    setUser(null);
    setIsAuthenticated(false);
    sessionStorage.removeItem('google_access_token');
    sessionStorage.removeItem('google_user');
  }, [accessToken]);

  const isDemoMode = accessToken === 'demo_token';

  return { isAuthenticated, isLoading, user, accessToken, signIn, signOut, isDemoMode };
}
