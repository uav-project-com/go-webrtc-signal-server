export class Base64Util {
  // ------------- util functions ------------------------------
  public static readonly base64ToObject = (str: string, toString?: boolean): string => {
    try {
      const jsonStr = atob(str);
      return toString? jsonStr : JSON.parse(jsonStr); // chuyển sang object
    } catch (_) {
      return str;
    }
  }

  public static readonly isBase64 = (str: string): boolean => {
    if (!str || str.length % 4 !== 0) {
      return false;
    }
    // regex kiểm tra ký tự base64 (+ padding =)
    const notBase64 = /[^A-Z0-9+\/=]/i;
    return !notBase64.test(str);
  }
}
