import { passwordObject, FlatPasswordObject, NestedPasswordObject } from '../interfaces/types';

const extractPassword = (obj: passwordObject): string => {
  if ('login' in obj && obj.login) {
    return (obj as NestedPasswordObject).login.password;
  }
  return (obj as FlatPasswordObject).login_password;
};

export default extractPassword;
