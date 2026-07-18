/**
 * サムネイルツール チームギャラリー保存通知（GAS）
 *
 * セットアップ手順:
 * 1. https://script.google.com で「新しいプロジェクト」を作成
 * 2. このコードを全部貼り付けて保存（プロジェクト名: サムネ通知 など）
 * 3. 「デプロイ」→「新しいデプロイ」→ 歯車で種類「ウェブアプリ」を選択
 *    - 説明: サムネ通知
 *    - 次のユーザーとして実行: 自分
 *    - アクセスできるユーザー: 全員
 * 4. 「デプロイ」を押し、アクセス承認（自分のGoogleアカウントを選択→許可）
 * 5. 表示された「ウェブアプリのURL（…/exec）」をコピーし、
 *    サムネイルツールの メニュー → メール通知設定 → 通知用URL に貼って保存
 *
 * ※メールは、このGASをデプロイしたGoogleアカウントのGmailから送信されます。
 */

const GALLERY_URL = 'https://meo-thumbnail-tools.vercel.app/thumbnail';

function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    const to = String(data.emails || '').trim();
    if (!to) return ContentService.createTextOutput('no recipients');

    const isTest = data.type === 'test';
    const subject = isTest
      ? '【サムネ通知】テスト送信です'
      : '【サムネ通知】' + (data.account || '') + '：ギャラリーに新しい画像が追加されました';

    const body = [
      isTest
        ? 'メール通知のテスト送信です。この通知設定は正しく動いています。'
        : 'チームギャラリーに新しい画像が保存されました。',
      '',
      'クライアント：' + (data.account || '-'),
      'カテゴリ：' + (data.category || '-'),
      'タイトル：' + (data.title || '-'),
      '保存日時：' + (data.when || ''),
      '',
      'ギャラリーを開く：' + GALLERY_URL,
      '',
      '（このメールはサムネイルツールから自動送信されています）',
    ].join('\n');

    to.split(/[,、\s]+/)
      .filter(function (a) { return a; })
      .forEach(function (addr) {
        GmailApp.sendEmail(addr, subject, body);
      });

    return ContentService.createTextOutput('ok');
  } catch (err) {
    return ContentService.createTextOutput('error: ' + err);
  }
}
