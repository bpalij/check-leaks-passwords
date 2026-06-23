export interface passwordObject {
  login_password: string,
  [key: string]: string | undefined,
}

export interface passwordObjectWithHash {
  hash: string,
  passwordObject: passwordObject,
}

export interface passwordObjectWithInjectedHash extends passwordObject {
  login_password_hash: string,
}

export interface passwordObjectWithInjectedHashAndLeaks extends passwordObjectWithInjectedHash {
  login_password_leaks: string,
  login_password_readable_leaks: string,
}

export interface hashWithPasswordObjects {
  hash: string,
  passwordObjects: Array<passwordObject>,
}

export interface hashWithLeaksAndPasswordObjects extends hashWithPasswordObjects {
  leaks: number,
  readableLeaks: string,
}
