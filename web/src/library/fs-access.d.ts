// The File System Access API pieces TypeScript's DOM library does not have yet (Chromium: Chrome, Edge, Brave...).
interface FileSystemHandlePermissionDescriptor { mode?: "read" | "readwrite"; }
interface FileSystemHandle {
  queryPermission(descriptor?: FileSystemHandlePermissionDescriptor): Promise<PermissionState>;
  requestPermission(descriptor?: FileSystemHandlePermissionDescriptor): Promise<PermissionState>;
}
interface Window {
  showDirectoryPicker?(options?: { id?: string; mode?: "read" | "readwrite" }): Promise<FileSystemDirectoryHandle>;
}
