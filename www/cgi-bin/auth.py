import os

try:
    from config import GROUPS
except ImportError:
    GROUPS = dict()

class RestrictedAccess(Exception):
    pass

def get_username():
    return os.environ.get('REMOTE_USER', 'guest')

def is_admin():
    user = get_username()
    return user in GROUPS and 'admin' in GROUPS[user]

def protect_dataset(cursor, dataset, protect_user=False, forbid_guest=False):
    # Bypass the checks for admin users.
    if is_admin():
        return

    query = f'SELECT `flags`, `project`, `owner` FROM `datasets` WHERE `id` = {dataset};'
    cursor.execute(query)
    row = cursor.fetchone()

    user = get_username()

    if protect_user:
        if forbid_guest and user == 'guest':
            raise RestrictedAccess('Guest users cannot perform this operation')

        # Check that the user is logged in.
        if user != row[2]:
            raise RestrictedAccess(f'Restricted to user {row[2]}')
    else:
        if forbid_guest and user == 'guest':
            raise RestrictedAccess('Guest users cannot perform this operation')

        # Check for restrictions.
        flags = row[0]
        if flags & 1:
            raise RestrictedAccess('Restricted view')

        # Check for user groups policy.
        project = row[1]
        if project != '' and (user not in GROUPS or project not in GROUPS[user]):
            raise RestrictedAccess(f'Restricted to group "{project}"')
